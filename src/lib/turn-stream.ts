import type { SSEEvent } from '@/lib/sse';
import { queryClient } from '@/lib/query-client';
import { useUIStore } from '@/stores/ui-store';
import type { ArtifactInfo, SessionMessagesResponse } from '@/lib/api';

// turn 事件流的共享消费层（turn-detach-resume 适配）。
// 后端把发起连接（POST /messages）与恢复连接（GET /turns/:rid/events）统一为同一条
// 订阅循环，两路帧格式完全一致——前端同样共用这一个消费函数，差异只在流如何建立
// （见 use-send-message 的发送路径与 use-turn-lifecycle 的 attach 路径）。
// adapt-session-message-queue：消费入参从 Response 改为「迭代器 + 已读首帧」——
// 发送路径必须先读首个有效事件区分 queued 接受与立即执行（见 classifyTurnStart），
// 读出的首帧连同剩余迭代器原样移交，保证首帧（如 agent_start）不丢失、response
// body 不被二次解析。attach 路径自建迭代器、首帧传 null，行为不变。

interface StreamEvent {
  type: string;
  agent: string;
  content?: string;
  // tool_call：content=工具名，参数在 meta.args（见 openapi SSEToolCall）。
  // tool_result：content 是工具结果状态信封 JSON 串（{"status":0,"result":...} /
  // {"status":1,"error":...}），meta.tool_call_id 关联对应 tool_call（见 openapi SSEToolResult）。
  // parent_tool_call_id：子 agent 单次 dispatch 的 run 身份（父 spawn tool_call id）。
  // agent_instance_id：跨 resume 稳定的实例线程身份；路由优先使用它，缺失为空串。
  // run_id：本 turn 的 run id（= trace id），所有事件携带；X-Run-Id 响应头缺失时的兜底渠道。
  meta?: {
    args?: unknown;
    tool_call_id?: string;
    parent_tool_call_id?: string;
    agent_instance_id?: string;
    run_id?: string;
    queue_position?: number;
    [key: string]: unknown;
  };
}

// 事件所属子 agent 单次 dispatch 的 run 身份；顶层事件返回空串。
function runIdOf(payload: StreamEvent): string {
  const id = payload.meta?.parent_tool_call_id;
  return typeof id === 'string' ? id : '';
}

// 动态子 Agent 的稳定实例身份；缺失（顶层/存量事件）返回空串。
function agentInstanceIdOf(payload: StreamEvent): string {
  const id = payload.meta?.agent_instance_id;
  return typeof id === 'string' ? id : '';
}

// 路由身份：子 Agent dispatch run + 实例线程 + 顶层 owner run（D5 段归属判据，
// 见 ui-store StreamingSegment.ownerRunId——与子 Agent runId 语义不同）。
function routeOf(payload: StreamEvent, ownerRunId: string) {
  return {
    runId: runIdOf(payload),
    agentInstanceId: agentInstanceIdOf(payload),
    ownerRunId,
  };
}

// rAF 节流保留到达顺序：同一路连续 token/reasoning 可合并，但不同类型或不同 agent
// 的事件不按 key 分桶重排。工具事件前会同步 flush，保证工具卡落在其前的正文之后。
interface BufferedStreamEvent {
  kind: 'token' | 'reasoning';
  agent: string;
  runId: string;
  agentInstanceId: string;
  content: string;
}

// 每个会话 + run 最后收到的 SSE 帧 id（后端 run 事件日志的 entry id）。刻意放在模块级
// 非响应式 map 而非 ui-store：它逐事件更新，入响应式 store 会让订阅 turnRuns 的组件（输入
// 禁用判据、防重）逐事件重渲染；它只在 attach 重连瞬间被读取（Last-Event-ID 请求头）。
// adapt-session-message-queue D5：游标绑定 (sessionId, runId) 身份——续传携带固定
// session/run 对，新 run 不能使用前一轮的游标，旧 run 的清理不删除新 run 的游标。
const lastEventIds: Record<string, string> = {};
const cursorKey = (sessionId: string, runId: string) => `${sessionId}\u0000${runId}`;

export function peekTurnEventId(sessionId: string, runId: string): string | undefined {
  return lastEventIds[cursorKey(sessionId, runId)];
}

// 清理该 run 的续传游标（终局/回落/detach 时由 run 生命周期调用，与登记释放配对）。
export function clearTurnStreamState(sessionId: string, runId: string) {
  delete lastEventIds[cursorKey(sessionId, runId)];
}

// ---- 首个有效事件分类（adapt-session-message-queue D2，纯逻辑供回归覆盖）----
// 新提交的 POST /messages 返回 200 SSE 后读取首个可解析事件，区分两种接受形态：
//   queued —— 已接受但排队等待（meta.run_id 是未来执行的 run 身份，不是活跃 run）；
//   execution —— 立即开始执行（首帧连同剩余迭代器交给独立 run 生命周期消费）。
// 无效 JSON 帧跳过继续读；读到流关闭仍无有效事件返回 empty。
// 首帧分类仅用于新提交：active attach 重放的 queued 是日志前缀，由 consumeTurnStream
// 忽略，不经本分类、不触发 detach。
export type TurnStart =
  | { kind: 'queued'; runId: string | null; queuePosition?: number }
  | { kind: 'execution'; runId: string | null }
  | { kind: 'empty' };

export async function classifyTurnStart(
  iterator: AsyncGenerator<SSEEvent, void, unknown>
): Promise<{
  start: TurnStart;
  iterator: AsyncGenerator<SSEEvent, void, unknown>;
  firstEvent: SSEEvent | null;
}> {
  while (true) {
    const step = await iterator.next();
    if (step.done) {
      return { start: { kind: 'empty' }, iterator, firstEvent: null };
    }
    let payload: StreamEvent;
    try {
      payload = JSON.parse(step.value.data) as StreamEvent;
    } catch {
      // 无效帧（如解析残留）不参与分类，继续读下一帧。
      continue;
    }
    const metaRunId = payload.meta?.run_id;
    const runId = typeof metaRunId === 'string' && metaRunId !== '' ? metaRunId : null;
    if (payload.type === 'queued') {
      const position = payload.meta?.queue_position;
      return {
        start: {
          kind: 'queued',
          runId,
          queuePosition: typeof position === 'number' ? position : undefined,
        },
        iterator,
        firstEvent: step.value,
      };
    }
    return { start: { kind: 'execution', runId }, iterator, firstEvent: step.value };
  }
}

// 把已读首帧接回迭代器头部：消费循环对「预读首帧 + 剩余流」与「完整流」无差别。
async function* prependEvent(
  first: SSEEvent | null,
  rest: AsyncGenerator<SSEEvent, void, unknown>
): AsyncGenerator<SSEEvent, void, unknown> {
  if (first) yield first;
  yield* rest;
}

// Node 回归环境无 rAF：退化为 16ms 定时器（浏览器路径不变）。
const scheduleFrame = (callback: () => void): number =>
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(callback)
    : (setTimeout(callback, 16) as unknown as number);
const cancelFrame = (handle: number): void => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
};

// 收尾重拉：助手整段回复在流式期间只存在于 streamingSegments，并不在消息缓存里。
// `done` 事件可能早于后端把这一轮写库到达——若此时立刻清空流式分段，回复会在
// 历史重取完成前消失；重取若因写入延迟返回空/旧数据，整个聊天区会暂时为空，
// 直到刷新页面才会恢复。这里反复重拉持久化历史，直到已落库行数超过起始快照
// （说明这一轮已落库）再按 run owner 清空流式分段；多次仍未增长则兜底清空，避免
// 流式尾巴残留。发送路径与 attach 路径共用：attach 的终局 done 同样可能早于落库。
// adapt-session-message-queue D5：清理按 (session, run) 归属——A 的迟到收尾不清
// B 接管后的分段/产物；计数只统计已落库行（乐观用户行 id 为负），并发提交的乐观
// 行不能替本 run 的历史落库作证。
export async function reconcileTurnHistory(sessionId: string, runId: string): Promise<void> {
  const queryKey = ['messages', sessionId];
  const persistedCount = (data: SessionMessagesResponse | undefined) =>
    (data?.messages ?? []).filter((msg) => msg.id > 0).length;
  const baseline = persistedCount(queryClient.getQueryData<SessionMessagesResponse>(queryKey));
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await queryClient.refetchQueries({ queryKey });
    } catch {
      // 单次重拉失败不致命，下一轮继续尝试。
    }
    if (persistedCount(queryClient.getQueryData<SessionMessagesResponse>(queryKey)) > baseline) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  useUIStore.getState().clearStreamingSegments(sessionId, runId);
  // turn-artifacts：历史已含持久化 artifact 行（分组接管产物条），清实时暂存
  // （owner 条件：新 run 的暂存不被旧 run 收尾误删）。
  useUIStore.getState().clearTurnArtifacts(sessionId, runId);
  // 本 turn 的子 Agent run 此刻才终态落库：失效该会话的 run 列表缓存，否则
  // placeholder 模式下气泡展开后 5 分钟 staleTime 内看不到刚结束的那次执行。
  void queryClient.invalidateQueries({ queryKey: ['subagent-runs', sessionId] });
}

// 消费一条 turn 事件流（发送响应或 attach 响应），把事件写入流式分段，直到流关闭
// （后端保证终局事件后关流；死 run 也有合成 done）。signal 仅用于收尾判断：
// aborted 时丢弃未 flush 的缓冲（detach 场景，分段不清、留待后续 attach），
// 否则同步 flush 剩余缓冲避免丢尾部 token。
// runId 是本流顶层 run 身份（段的 owner）；'' 表示未知，从事件 meta.run_id 惰性
// 解析并登记（X-Run-Id 与首帧 meta 双缺失的契约兜底路径），解析结果经
// onRunResolved 回调上报（生命周期按解析后的身份做条件释放与游标清理）。
export async function consumeTurnStream(
  sessionId: string,
  runId: string,
  iterator: AsyncGenerator<SSEEvent, void, unknown>,
  firstEvent: SSEEvent | null,
  signal?: AbortSignal,
  onRunResolved?: (runId: string) => void
): Promise<void> {
  const { startAgentSegment, appendSegmentContent, appendSegmentReasoning, pushSegmentToolCall, pushSegmentPlan, setSegmentStatus, setTurnRun, setTurnArtifacts } =
    useUIStore.getState();

  // 本流解析出的顶层 run 身份：已知则固定（D5：身份在生命周期入口绑定），
  // 未知则由首个携带 meta.run_id 的事件补齐。
  let resolvedRunId = runId;

  // 流式 token 本地缓冲 + rAF 节流：token / reasoning 先按到达顺序累积进缓冲，
  // 每个动画帧最多 flush 一次到 store，把渲染频率压到 ≤60fps。相邻的同类型同路
  // 事件会合并；并行/交错的子 agent 调用（线程身份不同）不会串段。
  // 收尾事件（done / agent_error / 异常 / abort）会同步 flush 剩余缓冲，
  // 避免丢失尾部 token；取消时也确保 rAF 句柄被回收，防止泄漏。
  let bufferedEvents: BufferedStreamEvent[] = [];
  let rafId: number | null = null;

  // 回收待执行的 rAF 句柄，避免流结束后残留回调写入状态。
  const cancelPendingFlush = () => {
    if (rafId != null) {
      cancelFrame(rafId);
      rafId = null;
    }
  };

  const flush = () => {
    cancelPendingFlush();
    // 取出并重置缓冲（闭包绑定，后续 token 写入新数组），再按事件顺序写入对应段。
    const events = bufferedEvents;
    bufferedEvents = [];
    for (const event of events) {
      const route = {
        runId: event.runId,
        agentInstanceId: event.agentInstanceId,
        ownerRunId: resolvedRunId,
      };
      if (event.kind === 'token') {
        appendSegmentContent(sessionId, event.agent, route, event.content);
      } else {
        appendSegmentReasoning(sessionId, event.agent, route, event.content);
      }
    }
  };

  const bufferEvent = (
    kind: BufferedStreamEvent['kind'],
    agent: string,
    runId: string,
    agentInstanceId: string,
    chunk: string,
  ) => {
    // 只合并真正的相邻同路同类型事件；一旦中间出现其他事件，就保留为独立节点，
    // 避免“token A → reasoning A → token A”被合并成 token → reasoning 的倒序。
    const last = bufferedEvents[bufferedEvents.length - 1];
    if (
      last &&
      last.kind === kind &&
      last.agent === agent &&
      last.runId === runId &&
      last.agentInstanceId === agentInstanceId
    ) {
      last.content += chunk;
      return;
    }
    bufferedEvents.push({ kind, agent, runId, agentInstanceId, content: chunk });
  };

  const scheduleFlush = () => {
    if (rafId != null) return;
    rafId = scheduleFrame(() => {
      rafId = null;
      flush();
    });
  };

  try {
    for await (const sseEvent of prependEvent(firstEvent, iterator)) {
      // 记录帧 id 供 attach 重连续传（Last-Event-ID，事件粒度无重放缝隙）；
      // 游标按本 run 身份保存（含 queued 帧——它在 run 日志中是真实条目）。
      if (sseEvent.id) lastEventIds[cursorKey(sessionId, resolvedRunId)] = sseEvent.id;

      let payload: StreamEvent;
      try {
        payload = JSON.parse(sseEvent.data) as StreamEvent;
      } catch {
        continue;
      }

      // X-Run-Id 与首帧 meta 都缺失时的兜底：从事件 meta 补记本 turn 的 run id（取消/禁用
      // 判据都依赖它；仅补记一次，不逐事件覆盖）。补记后 owner 随之解析，之后的段与
      // 游标都按该 run 归属。
      if (!resolvedRunId) {
        const metaRunId = payload.meta?.run_id;
        if (
          typeof metaRunId === 'string' &&
          metaRunId !== '' &&
          !useUIStore.getState().turnRuns[sessionId]
        ) {
          resolvedRunId = metaRunId;
          setTurnRun(sessionId, metaRunId);
          onRunResolved?.(metaRunId);
        }
      }

      switch (payload.type) {
        // session-message-queue：queued 只在新提交首帧出现（发送路径已分类并 detach）；
        // 消费循环里遇到的是 active attach 的日志前缀重放——不是消息正文、不建段、
        // 不触发 detach，帧 id 已在上方计入本 run 的续传游标。
        case 'queued':
          break;
        case 'agent_start':
          // push/唤醒线程段。动态子 Agent 同实例 resume 复用旧段，并发实例各自成段。
          startAgentSegment(sessionId, payload.agent, routeOf(payload, resolvedRunId));
          break;
        case 'token': {
          // 按 (agent, runId) 累积进缓冲，下一帧 flush 时追加到对应活动段。
          // 若 token 先于 agent_start 到达，appendSegmentContent 会按复合键惰性建段。
          if (payload.content) {
            const route = routeOf(payload, resolvedRunId);
            bufferEvent(
              'token',
              payload.agent,
              route.runId,
              route.agentInstanceId,
              payload.content
            );
            scheduleFlush();
          }
          break;
        }
        case 'reasoning': {
          if (payload.content) {
            const route = routeOf(payload, resolvedRunId);
            bufferEvent(
              'reasoning',
              payload.agent,
              route.runId,
              route.agentInstanceId,
              payload.content
            );
            scheduleFlush();
          }
          break;
        }
        case 'tool_call': {
          // SSE 的 tool_call：content=工具名、参数在 meta.args。组装成与持久化一致的
          // {"tool_call_id","name","args"} JSON（后端 event_mapper.go 同此格式），否则
          // parseToolCall 拿不到参数，表现为流式期间「无参数」。
          const meta = payload.meta ?? {};
          const toolCallId =
            typeof meta.tool_call_id === 'string' ? meta.tool_call_id : '';
          const record = JSON.stringify({
            tool_call_id: toolCallId,
            name: payload.content ?? '',
            args: meta.args ?? {},
          });
          flush();
          pushSegmentToolCall(sessionId, payload.agent, routeOf(payload, resolvedRunId), record, {
            kind: 'call',
            toolCallId,
          });
          break;
        }
        case 'tool_result': {
          // SSE 的 tool_result（见 openapi SSEToolResult）：content 即工具结果的状态信封
          // JSON 串——registry 工具为 {"status":0,"result":...} / {"status":1,"error":...}，
          // invoke_* 子 agent 分发为子 agent 输出原文。先落完缓冲正文，再把结果作为
          // 结果按 tool_call_id 合并回对应调用卡，避免 rAF 延迟导致顺序颠倒。
          flush();
          pushSegmentToolCall(
            sessionId,
            payload.agent,
            routeOf(payload, resolvedRunId),
            payload.content ?? '',
            {
              kind: 'result',
              toolCallId:
                typeof payload.meta?.tool_call_id === 'string'
                  ? payload.meta.tool_call_id
                  : undefined,
            },
          );
          break;
        }
        case 'plan_updated': {
          // 语义计划快照与 token 分开落 store：它不是正文，不能拼进 content；
          // 也不能进 rAF 缓冲，否则可能被后续 token 重排到工具卡之后。
          flush();
          pushSegmentPlan(sessionId, payload.agent, routeOf(payload, resolvedRunId), payload.content ?? '');
          break;
        }
        case 'agent_end':
          // 先 flush 该路的待落缓冲，再按复合键置 idle——否则置 idle 后待 flush 的
          // token 会因找不到活动段而被惰性建段，产生重复的孤立 running 段。
          flush();
          setSegmentStatus(sessionId, payload.agent, routeOf(payload, resolvedRunId), 'idle');
          break;
        case 'agent_error':
          // 出错时先同步 flush，确保已收到的尾部 token 不丢失、不截断，再把错误文案
          // 按历史同款格式追加进段（后端不落库 agent_error 行时，这是错误详情的
          // 唯一展示渠道），最后置段 error。
          flush();
          if (payload.content) {
            appendSegmentContent(
              sessionId,
              payload.agent,
              routeOf(payload, resolvedRunId),
              `\n\n[错误] ${payload.content}`
            );
          }
          setSegmentStatus(sessionId, payload.agent, routeOf(payload, resolvedRunId), 'error');
          break;
        case 'done': {
          // 仅同步 flush 剩余缓冲；流式分段的清空交给流结束后的 reconcileTurnHistory，
          // 由它确认这一轮已落库后再清，避免回复在历史重取前消失。
          flush();
          // turn-artifacts：done.meta.artifacts 是本轮产物摘要（实时流专属，
          // 不持久化；历史由 artifact 事件行重建）。按本 run owner 暂存 ui-store 供
          // 流式区末尾渲染产物条；done 每 turn 恰好一次，无需去重。
          const artifacts = (payload.meta as { artifacts?: ArtifactInfo[] } | undefined)?.artifacts;
          if (artifacts?.length) setTurnArtifacts(sessionId, resolvedRunId, artifacts);
          break;
        }
      }
    }
  } finally {
    // detach（signal 已中止）路径：仅回收 rAF 句柄、丢弃缓冲——流式分段不清（turn 在
    // 服务端继续，重开时由 attach 恢复）。正常结束 / 出错：同步 flush 剩余缓冲，
    // 避免丢失尾部 token。
    if (signal?.aborted) {
      cancelPendingFlush();
    } else {
      flush();
    }
  }
}
