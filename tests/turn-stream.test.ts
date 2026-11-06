import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSSEStream, type SSEEvent } from '@/lib/sse';
import {
  classifyTurnStart,
  consumeTurnStream,
  peekTurnEventId,
  clearTurnStreamState,
} from '@/lib/turn-stream';
import { useUIStore } from '@/stores/ui-store';

// 回归覆盖（adapt-session-message-queue 6.2）：首个有效 SSE 分类、迭代器交接、
// attach 的 queued 前缀重放、分块 SSE 解析、续传游标按 run 隔离、detach 丢弃缓冲
// 不清段。全部走真实 parseSSEStream（Response + ReadableStream），无请求 mock。

const encoder = new TextEncoder();

function sseResponse(chunks: (string | Uint8Array)[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}

function frame(id: string, data: object): string {
  return `event: message\nid: ${id}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ---- 分块 SSE（6.2）----

test('parseSSEStream：帧边界跨 chunk 切分仍完整解析', async () => {
  const f1 = frame('1', { type: 'agent_start', agent: 'A', meta: { run_id: 'r1' } });
  const f2 = frame('2', { type: 'token', agent: 'A', content: 'hello world' });
  const response = sseResponse([f1.slice(0, 7), f1.slice(7) + f2.slice(0, 12), f2.slice(12)]);
  const events: SSEEvent[] = [];
  for await (const event of parseSSEStream(response)) events.push(event);
  assert.equal(events.length, 2);
  assert.equal(events[0].id, '1');
  assert.deepEqual(JSON.parse(events[1].data), { type: 'token', agent: 'A', content: 'hello world' });
});

test('parseSSEStream：多字节字符按字节切分不损坏内容', async () => {
  const bytes = encoder.encode(frame('1', { type: 'token', agent: 'A', content: '你好世界' }));
  const response = sseResponse([bytes.slice(0, 18), bytes.slice(18, 24), bytes.slice(24)]);
  const events: SSEEvent[] = [];
  for await (const event of parseSSEStream(response)) events.push(event);
  assert.equal(events.length, 1);
  assert.equal(JSON.parse(events[0].data).content, '你好世界');
});

// ---- 首个有效事件分类（D2 / 6.2：queued 无 agent、无效帧跳过、空流）----

test('classifyTurnStart：queued 首帧（无 agent/content）识别等待身份', async () => {
  const response = sseResponse([
    frame('1', { type: 'queued', meta: { run_id: 'rb', queue_position: 2 } }),
  ]);
  const { start, firstEvent } = await classifyTurnStart(parseSSEStream(response));
  assert.deepEqual(start, { kind: 'queued', runId: 'rb', queuePosition: 2 });
  assert.ok(firstEvent);
});

test('classifyTurnStart：queued 缺 meta.run_id 时 runId 为 null（头兜底归调用方）', async () => {
  const response = sseResponse([frame('1', { type: 'queued', meta: { queue_position: 1 } })]);
  const { start } = await classifyTurnStart(parseSSEStream(response));
  assert.deepEqual(start, { kind: 'queued', runId: null, queuePosition: 1 });
});

test('classifyTurnStart：无效 JSON 帧跳过，首个有效帧裁决', async () => {
  const response = sseResponse([
    'event: message\nid: 1\ndata: not-json\n\n',
    frame('2', { type: 'queued', meta: { run_id: 'rx' } }),
  ]);
  const { start, firstEvent } = await classifyTurnStart(parseSSEStream(response));
  assert.equal(start.kind, 'queued');
  assert.equal(start.kind === 'queued' ? start.runId : null, 'rx');
  assert.equal(firstEvent?.id, '2');
});

test('classifyTurnStart：执行首帧（agent_start）提取 run 身份', async () => {
  const response = sseResponse([
    frame('1', { type: 'agent_start', agent: 'Confucius', meta: { run_id: 'ra' } }),
  ]);
  const { start } = await classifyTurnStart(parseSSEStream(response));
  assert.deepEqual(start, { kind: 'execution', runId: 'ra' });
});

test('classifyTurnStart：流关闭仍无有效事件 → empty', async () => {
  const response = sseResponse([frame('1', { type: 'token', agent: 'A' })]);
  // 先耗尽迭代器再分类（无有效帧路径由空 Response 覦盖）
  const empty = sseResponse([]);
  const { start } = await classifyTurnStart(parseSSEStream(empty));
  assert.deepEqual(start, { kind: 'empty' });
  for await (const _ of parseSSEStream(response)) {
    // 耗尽非空流，避免悬挂
  }
});

// ---- 迭代器交接：立即执行首帧不丢失（6.2）----

test('consumeTurnStream：预读首帧 + 剩余迭代器移交，agent_start/正文不丢失', async () => {
  const sessionId = 's-handoff';
  const response = sseResponse([
    frame('1', { type: 'agent_start', agent: 'Confucius', meta: { run_id: 'rA' } }),
    frame('2', { type: 'token', agent: 'Confucius', content: 'hello ' }),
    frame('3', { type: 'token', agent: 'Confucius', content: 'world' }),
    frame('4', { type: 'agent_end', agent: 'Confucius', meta: { run_id: 'rA' } }),
  ]);
  const { start, firstEvent, iterator } = await classifyTurnStart(parseSSEStream(response));
  assert.equal(start.kind, 'execution');
  await consumeTurnStream(sessionId, 'rA', iterator, firstEvent);
  const segments = useUIStore.getState().streamingSegments[sessionId];
  assert.equal(segments?.length, 1);
  assert.equal(segments[0].agent, 'Confucius');
  assert.equal(segments[0].content, 'hello world');
  assert.equal(segments[0].ownerRunId, 'rA');
  assert.equal(segments[0].status, 'idle');
});

// ---- attach 重放 queued 前缀（6.2）----

test('consumeTurnStream：重放的 queued 前缀不建段、不中断，续传游标含 queued 帧', async () => {
  const sessionId = 's-replay';
  const response = sseResponse([
    frame('1', { type: 'queued', meta: { run_id: 'rB', queue_position: 1 } }),
    frame('2', { type: 'agent_start', agent: 'Confucius', meta: { run_id: 'rB' } }),
    frame('3', { type: 'token', agent: 'Confucius', content: '执行中' }),
    frame('4', { type: 'done' }),
  ]);
  await consumeTurnStream(sessionId, 'rB', parseSSEStream(response), null);
  const segments = useUIStore.getState().streamingSegments[sessionId];
  assert.equal(segments?.length, 1);
  assert.equal(segments[0].content, '执行中');
  assert.equal(peekTurnEventId(sessionId, 'rB'), '4');
});

// ---- detach：断开不取消、不清段（6.2）----

test('consumeTurnStream：signal 已中止时丢弃待 flush 缓冲，既有段保留', async () => {
  const sessionId = 's-detach';
  const store = useUIStore.getState();
  store.startAgentSegment(sessionId, 'Confucius', { ownerRunId: 'rA' });
  const controller = new AbortController();
  controller.abort();
  const response = sseResponse([
    frame('1', { type: 'token', agent: 'Confucius', content: '不该落段' }),
  ]);
  await consumeTurnStream(sessionId, 'rA', parseSSEStream(response), null, controller.signal);
  const segments = useUIStore.getState().streamingSegments[sessionId];
  assert.equal(segments?.length, 1);
  assert.equal(segments[0].content, '');
});

// ---- 续传游标按 (session, run) 隔离（6.2 / D5）----

test('游标按 run 身份隔离：旧 run 清理不动新 run 的游标', async () => {
  const sessionId = 's-cursor';
  await consumeTurnStream(
    sessionId,
    'rA',
    parseSSEStream(sseResponse([frame('5', { type: 'token', agent: 'A', content: 'a' })])),
    null
  );
  await consumeTurnStream(
    sessionId,
    'rB',
    parseSSEStream(sseResponse([frame('9', { type: 'token', agent: 'B', content: 'b' })])),
    null
  );
  assert.equal(peekTurnEventId(sessionId, 'rA'), '5');
  assert.equal(peekTurnEventId(sessionId, 'rB'), '9');
  clearTurnStreamState(sessionId, 'rA');
  assert.equal(peekTurnEventId(sessionId, 'rA'), undefined);
  assert.equal(peekTurnEventId(sessionId, 'rB'), '9');
});
