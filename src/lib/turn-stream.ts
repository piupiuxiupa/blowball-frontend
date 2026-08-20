import { parseSSEStream } from '@/lib/sse';
import { queryClient } from '@/lib/query-client';
import { useUIStore } from '@/stores/ui-store';
import type { SessionMessagesResponse } from '@/lib/api';

// turn 事件流的共享消费层（turn-detach-resume 适配）。
// 后端把发起连接（POST /messages）与恢复连接（GET /turns/:rid/events）统一为同一条
// 订阅循环，两路帧格式完全一致——前端同样共用这一个消费函数，差异只在流如何建立
// （见 use-send-message 的发送路径与 use-turn-lifecycle 的 attach 路径）。

interface StreamEvent {
  type: string;
  agent: string;
  content?: string;
  // tool_call：content=工具名，参数在 meta.args（见 openapi SSEToolCall）。
  // tool_result：content 是工具结果状态信封 JSON 串（{"status":0,"result":...} /
  // {"status":1,"error":...}），meta.tool_call_id 关联对应 tool_call（见 openapi SSEToolResult）。
  // parent_tool_call_id：子 agent 调用的 run 身份（父 invoke tool_call id），仅子 agent
  // 事件携带；并发同名调用靠它区分路由，缺失为空串（顶层事件，退化按 agent 名路由）。
  // run_id：本 turn 的 run id（= trace id），所有事件携带；X-Run-Id 响应头缺失时的兜底渠道。
  meta?: {
    args?: unknown;
    tool_call_id?: string;
    parent_tool_call_id?: string;
    run_id?: string;
    [key: string]: unknown;
  };
}

// 事件所属子 agent 调用的 run 身份；顶层事件返回空串。
function runIdOf(payload: StreamEvent): string {
  const id = payload.meta?.parent_tool_call_id;
  return typeof id === 'string' ? id : '';
}

// 流缓冲键：agent 与 runId 的复合（agent 名不含空格（Confucius/Chongzhi/Liang/user），
// 按首个空格拆回即可）。
function bufferKey(agent: string, runId: string): string {
  return `${agent} ${runId}`;
}
function splitBufferKey(key: string): { agent: string; runId: string } {
  const i = key.indexOf(' ');
  return { agent: key.slice(0, i), runId: key.slice(i + 1) };
}

// 每会话最后收到的 SSE 帧 id（后端 run 事件日志的 entry id）。刻意放在模块级非响应式
// map 而非 ui-store：它逐事件更新，入响应式 store 会让订阅 turnRuns 的组件（输入禁用
// 判据、防重）逐事件重渲染；它只在 attach 重连瞬间被读取（Last-Event-ID 请求头）。
const lastEventIds: Record<string, string> = {};

export function peekTurnEventId(sessionId: string): string | undefined {
  return lastEventIds[sessionId];
}

// 清理该会话的 turn 消费痕迹（终局/回落时调用；与 ui-store 的 setTurnRun(sid, null) 配对）。
export function clearTurnStreamState(sessionId: string) {
  delete lastEventIds[sessionId];
}

// 收尾重拉：助手整段回复在流式期间只存在于 streamingSegments，并不在消息缓存里。
// `done` 事件可能早于后端把这一轮写库到达——若此时立刻清空流式分段，回复会在
// 历史重取完成前消失；重取若因写入延迟返回空/旧数据，整个聊天区会暂时为空，
// 直到刷新页面才会恢复。这里反复重拉持久化历史，直到消息数超过起始快照
// （说明这一轮已落库）再清空流式分段；多次仍未增长则兜底清空，避免流式尾巴残留。
// 发送路径与 attach 路径共用：attach 的终局 done 同样可能早于落库。
export async function reconcileTurnHistory(sessionId: string): Promise<void> {
  const queryKey = ['messages', sessionId];
  // 发送路径此刻缓存里还带着 onMutate 写入的乐观用户消息，故 baseline = 当前条数
  // （含乐观消息）；attach 路径无乐观消息，baseline 即当前历史条数。
  const baseline = queryClient.getQueryData<SessionMessagesResponse>(queryKey)?.messages?.length ?? 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await queryClient.refetchQueries({ queryKey });
    } catch {
      // 单次重拉失败不致命，下一轮继续尝试。
    }
    const after = queryClient.getQueryData<SessionMessagesResponse>(queryKey)?.messages?.length ?? 0;
    if (after > baseline) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  useUIStore.getState().clearStreamingSegments(sessionId);
}

// 消费一条 turn 事件流（发送响应或 attach 响应），把事件写入流式分段，直到流关闭
// （后端保证终局事件后关流；死 run 也有合成 done）。signal 仅用于收尾判断：
// aborted 时丢弃未 flush 的缓冲（detach 场景，分段不清、留待后续 attach），
// 否则同步 flush 剩余缓冲避免丢尾部 token。
export async function consumeTurnStream(
  sessionId: string,
  response: Response,
  signal?: AbortSignal,
): Promise<void> {
  const { startAgentSegment, appendSegmentContent, appendSegmentReasoning, pushSegmentToolCall, setSegmentStatus, setTurnRun } =
    useUIStore.getState();

  // 流式 token 本地缓冲 + rAF 节流：token / reasoning 先累积进缓冲，
  // 每个动画帧最多 flush 一次到 store，把渲染频率压到 ≤60fps。
  // 缓冲按 (agent, runId) 复合键分桶：flush 时把每路的串追加到其活动段——
  // 并行/交错的同名子 agent 调用（runId 不同）不会串段；串行回合下退化为单条目。
  // 收尾事件（done / agent_error / 异常 / abort）会同步 flush 剩余缓冲，
  // 避免丢失尾部 token；取消时也确保 rAF 句柄被回收，防止泄漏。
  let tokenBuffers: Record<string, string> = {};
  let reasoningBuffers: Record<string, string> = {};
  let rafId: number | null = null;

  // 回收待执行的 rAF 句柄，避免流结束后残留回调写入状态。
  const cancelPendingFlush = () => {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const flush = () => {
    cancelPendingFlush();
    // 取出并重置缓冲（闭包绑定，后续 token 写入新对象），再按复合键追加到活动段。
    const tokens = tokenBuffers;
    const reasoning = reasoningBuffers;
    tokenBuffers = {};
    reasoningBuffers = {};
    for (const key in tokens) {
      const { agent, runId } = splitBufferKey(key);
      if (tokens[key]) appendSegmentContent(sessionId, agent, runId, tokens[key]);
    }
    for (const key in reasoning) {
      const { agent, runId } = splitBufferKey(key);
      if (reasoning[key]) appendSegmentReasoning(sessionId, agent, runId, reasoning[key]);
    }
  };

  const scheduleFlush = () => {
    if (rafId != null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      flush();
    });
  };

  try {
    for await (const sseEvent of parseSSEStream(response)) {
      // 记录帧 id 供 attach 重连续传（Last-Event-ID，事件粒度无重放缝隙）。
      if (sseEvent.id) lastEventIds[sessionId] = sseEvent.id;

      let payload: StreamEvent;
      try {
        payload = JSON.parse(sseEvent.data) as StreamEvent;
      } catch {
        continue;
      }

      // X-Run-Id 响应头缺失时的兜底：从事件 meta 补记本 turn 的 run id（取消/禁用判据
      // 都依赖它；仅补记一次，不逐事件覆盖）。
      const metaRunId = payload.meta?.run_id;
      if (typeof metaRunId === 'string' && !useUIStore.getState().turnRuns[sessionId]) {
        setTurnRun(sessionId, metaRunId);
      }

      switch (payload.type) {
        case 'agent_start':
          // push 新段、置 running。活动段即数组末尾。子 agent 调用带 runId 各自成段。
          startAgentSegment(sessionId, payload.agent, runIdOf(payload));
          break;
        case 'token': {
          // 按 (agent, runId) 累积进缓冲，下一帧 flush 时追加到对应活动段。
          // 若 token 先于 agent_start 到达，appendSegmentContent 会按复合键惰性建段。
          const key = bufferKey(payload.agent, runIdOf(payload));
          if (payload.content) {
            tokenBuffers[key] = (tokenBuffers[key] ?? '') + payload.content;
            scheduleFlush();
          }
          break;
        }
        case 'reasoning': {
          const key = bufferKey(payload.agent, runIdOf(payload));
          if (payload.content) {
            reasoningBuffers[key] = (reasoningBuffers[key] ?? '') + payload.content;
            scheduleFlush();
          }
          break;
        }
        case 'tool_call': {
          // SSE 的 tool_call：content=工具名、参数在 meta.args。组装成与持久化一致的
          // {"tool_call_id","name","args"} JSON（后端 event_mapper.go 同此格式），否则
          // parseToolCall 拿不到参数，表现为流式期间「无参数」。
          const meta = payload.meta ?? {};
          const record = JSON.stringify({
            tool_call_id: typeof meta.tool_call_id === 'string' ? meta.tool_call_id : '',
            name: payload.content ?? '',
            args: meta.args ?? {},
          });
          pushSegmentToolCall(sessionId, payload.agent, runIdOf(payload), record);
          break;
        }
        case 'tool_result': {
          // SSE 的 tool_result（见 openapi SSEToolResult）：content 即工具结果的状态信封
          // JSON 串——registry 工具为 {"status":0,"result":...} / {"status":1,"error":...}，
          // invoke_* 子 agent 分发为子 agent 输出原文。直接并入活动段 toolCalls，由
          // ToolCallBubble.parseToolCall 识别为「工具结果」，并在 status===1 时整卡标红。
          pushSegmentToolCall(sessionId, payload.agent, runIdOf(payload), payload.content ?? '');
          break;
        }
        case 'agent_end':
          // 先 flush 该路的待落缓冲，再按复合键置 idle——否则置 idle 后待 flush 的
          // token 会因找不到活动段而被惰性建段，产生重复的孤立 running 段。
          flush();
          setSegmentStatus(sessionId, payload.agent, runIdOf(payload), 'idle');
          break;
        case 'agent_error':
          // 出错时先同步 flush，确保已收到的尾部 token 不丢失、不截断，再置段 error。
          flush();
          setSegmentStatus(sessionId, payload.agent, runIdOf(payload), 'error');
          break;
        case 'done':
          // 仅同步 flush 剩余缓冲；流式分段的清空交给流结束后的 reconcileTurnHistory，
          // 由它确认这一轮已落库后再清，避免回复在历史重取前消失。
          flush();
          break;
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
