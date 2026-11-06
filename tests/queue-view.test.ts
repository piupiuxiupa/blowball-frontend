import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeQueueView, shouldKeepConfirm } from '@/lib/queue-view';
import type { SessionQueueEntry, AttachmentRef } from '@/lib/api';
import type { QueueConfirmItem } from '@/stores/pending-queue-store';

// 回归覆盖（adapt-session-message-queue 6.4 的纯逻辑部分）：队列 FIFO 去重、
// 临时确认项接管、活跃 run 退出等待展示（等待项与用户气泡不重复）。

function entry(runId: string, overrides: Partial<SessionQueueEntry> = {}): SessionQueueEntry {
  return {
    run_id: runId,
    content: `content-${runId}`,
    model: `model-${runId}`,
    enqueued_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function confirm(runId: string, overrides: Partial<QueueConfirmItem> = {}): QueueConfirmItem {
  return {
    runId,
    content: `confirm-${runId}`,
    at: 1_000,
    ...overrides,
  }
}

const attachments: AttachmentRef[] = [{ id: 'att1', filename: 'a.png', mime: 'image/png' }];

test('mergeQueueView：服务端 FIFO 序 + run id 去重', () => {
  const items = mergeQueueView(
    [entry('b'), entry('c'), entry('d'), entry('b')],
    [],
    null
  );
  assert.deepEqual(items.map((item) => item.runId), ['b', 'c', 'd']);
  assert.ok(items.every((item) => item.source === 'server'));
});

test('mergeQueueView：快照包含确认项时由服务端条目接管（不重复）', () => {
  const items = mergeQueueView([entry('b'), entry('c')], [confirm('b'), confirm('e')], null);
  assert.deepEqual(items.map((item) => item.runId), ['b', 'c', 'e']);
  assert.equal(items.find((item) => item.runId === 'b')?.source, 'server');
  assert.equal(items.find((item) => item.runId === 'e')?.source, 'confirm');
});

test('mergeQueueView：确认项按确认顺序续在快照尾部（FIFO）', () => {
  const items = mergeQueueView([entry('x')], [confirm('b'), confirm('c')], null);
  assert.deepEqual(items.map((item) => item.runId), ['x', 'b', 'c']);
});

test('mergeQueueView：活跃 run 退出等待展示（执行中不重复气泡）', () => {
  const items = mergeQueueView([entry('a'), entry('b'), entry('c')], [confirm('d')], 'b');
  assert.deepEqual(items.map((item) => item.runId), ['a', 'c', 'd']);
});

test('mergeQueueView：附件引用透传（展示用 content 端点键）', () => {
  const items = mergeQueueView([entry('a', { attachments })], [], null);
  assert.deepEqual(items[0].attachments, attachments);
});

test('shouldKeepConfirm：快照接管与宽限', () => {
  const now = 10_000;
  // 在最新快照中 → 保留（服务端条目接管前的过渡）。
  assert.equal(shouldKeepConfirm(confirm('b', { at: now }), new Set(['b']), now), true);
  // 不在快照、宽限期内 → 保留（入队写入可见性竞态）。
  assert.equal(shouldKeepConfirm(confirm('b', { at: now - 1_000 }), new Set(), now, 3_000), true);
  // 不在快照、超宽限 → 丢弃（已开始执行/他端撤回；降级空快照由下轮探测恢复）。
  assert.equal(shouldKeepConfirm(confirm('b', { at: now - 4_000 }), new Set(), now, 3_000), false);
});
