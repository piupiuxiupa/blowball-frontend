import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { apiPostStream } from '@/lib/api';
import { parseSSEStream } from '@/lib/sse';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';
import type { SendMessageRequest, SessionMessagesResponse, Message } from '@/lib/api';

interface StreamEvent {
  type: string;
  agent: string;
  content?: string;
  // tool_call 事件：content=工具名，参数在 meta.args（见 openapi SSEToolCall）。
  meta?: {
    args?: unknown;
    tool_call_id?: string;
    [key: string]: unknown;
  };
}

function buildOptimisticUserMessage(sessionId: string, content: string, messages: Message[]): Message {
  const now = new Date().toISOString();
  const maxIndex = messages.reduce((max, m) => (m.msg_index > max ? m.msg_index : max), 0);
  return {
    id: -Date.now(),
    session_id: sessionId,
    msg_time: now,
    agent: 'user',
    msg_index: maxIndex + 1,
    role: 'user',
    event_type: 'message',
    content,
    trace_id: '',
    update_time: now,
  };
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  const { token } = useAuthStore();
  const {
    startAgentSegment,
    appendSegmentContent,
    appendSegmentReasoning,
    pushSegmentToolCall,
    setSegmentStatus,
    clearStreamingSegments,
  } = useUIStore();
  const abortControllerRef = useRef<AbortController | null>(null);

  // 收尾重拉：助手整段回复在流式期间只存在于 streamingSegments，并不在消息缓存里。
  // `done` 事件可能早于后端把这一轮写库到达——若此时立刻清空流式分段，回复会在
  // 历史重取完成前消失；重取若因写入延迟返回空/旧数据，整个聊天区会暂时为空，
  // 直到刷新页面才会恢复。这里反复重拉持久化历史，直到消息数超过发送前快照
  // （说明这一轮已落库）再清空流式分段；多次仍未增长则兜底清空，避免流式尾巴残留。
  // reconcile 期间 mutation 仍处于 pending，可阻挡新一轮发送，避免与下一次流式写入竞态。
  const reconcileHistory = async (sessionId: string) => {
    const queryKey = ['messages', sessionId];
    // 此刻消息缓存里还带着 onMutate 写入的乐观用户消息，故 baseline = 发送前条数 + 1。
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
    clearStreamingSegments(sessionId);
  };

  const mutation = useMutation({
    mutationFn: async ({
      sessionId,
      content,
    }: {
      sessionId: string;
      content: string;
    }) => {
      if (!token) throw new Error('Not authenticated');

      abortControllerRef.current = new AbortController();

      // 流式 token 本地缓冲 + rAF 节流：token / reasoning 先累积进缓冲，
      // 每个动画帧最多 flush 一次到 store，把渲染频率压到 ≤60fps。
      // 缓冲按 agent 分桶（design D2）：flush 时把每个 agent 的串追加到其活动段，
      // 即便后端未来并行/交错输出多 agent 也不会串段；串行回合下退化为单条目。
      // 收尾事件（done / agent_error / 异常 / abort）会同步 flush 剩余缓冲，
      // 避免丢失尾部 token；取消时也确保 rAF 句柄被回收，防止泄漏。
      let tokenBuffers: Record<string, string> = {};
      let reasoningBuffers: Record<string, string> = {};
      let rafId: number | null = null;

      // 回收待执行的 rAF 句柄，避免 abort 后残留回调写入状态。
      const cancelPendingFlush = () => {
        if (rafId != null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
      };

      const flush = () => {
        cancelPendingFlush();
        // 取出并重置缓冲（闭包绑定，后续 token 写入新对象），再按 agent 追加到活动段。
        const tokens = tokenBuffers;
        const reasoning = reasoningBuffers;
        tokenBuffers = {};
        reasoningBuffers = {};
        for (const agent in tokens) {
          if (tokens[agent]) appendSegmentContent(sessionId, agent, tokens[agent]);
        }
        for (const agent in reasoning) {
          if (reasoning[agent]) appendSegmentReasoning(sessionId, agent, reasoning[agent]);
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
        const response = await apiPostStream(
          `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
          {
            body: { content } as SendMessageRequest,
            token,
            signal: abortControllerRef.current.signal,
          }
        );

        for await (const sseEvent of parseSSEStream(response)) {
          let payload: StreamEvent;
          try {
            payload = JSON.parse(sseEvent.data) as StreamEvent;
          } catch {
            continue;
          }

          switch (payload.type) {
            case 'agent_start':
              // push 新段、置 running。活动段即数组末尾。
              startAgentSegment(sessionId, payload.agent);
              break;
            case 'token':
              // 按 agent 累积进缓冲，下一帧 flush 时追加到该 agent 活动段。
              // 若 token 先于 agent_start 到达，appendSegmentContent 会按事件 agent 惰性建段。
              if (payload.content) {
                tokenBuffers[payload.agent] = (tokenBuffers[payload.agent] ?? '') + payload.content;
                scheduleFlush();
              }
              break;
            case 'reasoning':
              if (payload.content) {
                reasoningBuffers[payload.agent] =
                  (reasoningBuffers[payload.agent] ?? '') + payload.content;
                scheduleFlush();
              }
              break;
            case 'tool_call': {
              // SSE 的 tool_call：content=工具名、参数在 meta.args（见 openapi SSEToolCall）。
              // 持久化路径存的是 {"tool_call_id","name","args"} JSON（后端 event_mapper.go），
              // ToolCallBubble.parseToolCall 据此解析出工具名+参数。流式需组装成同样格式，
              // 否则只存了工具名，parseToolCall 拿不到参数，表现为流式期间「无参数」。
              const meta = payload.meta ?? {};
              const record = JSON.stringify({
                tool_call_id: typeof meta.tool_call_id === 'string' ? meta.tool_call_id : '',
                name: payload.content ?? '',
                args: meta.args ?? {},
              });
              pushSegmentToolCall(sessionId, payload.agent, record);
              break;
            }
            case 'agent_end':
              // 先 flush 该 agent 的待落缓冲，再置 idle——否则置 idle 后待 flush 的 token
              // 会因找不到活动段而被惰性建段，产生重复的孤立 running 段（与 agent_error 同理）。
              flush();
              setSegmentStatus(sessionId, payload.agent, 'idle');
              break;
            case 'agent_error':
              // 出错时先同步 flush，确保已收到的尾部 token 不丢失、不截断，再置段 error。
              flush();
              setSegmentStatus(sessionId, payload.agent, 'error');
              break;
            case 'done':
              // 仅同步 flush 剩余缓冲；流式分段的清空交给流结束后的 reconcileHistory，
              // 由它确认这一轮已落库后再清，避免回复在历史重取前消失。
              flush();
              break;
          }
        }
      } finally {
        // abort 路径：abort() 已清空分段，这里仅回收 rAF 句柄、丢弃缓冲——
        // 若仍 flush，缓冲里的尾部 token 会被惰性建成孤立 running 段，短暂闪现已取消的内容。
        // 正常结束 / 出错：同步 flush 剩余缓冲，避免丢失尾部 token。
        const aborted = abortControllerRef.current?.signal.aborted ?? false;
        if (aborted) {
          cancelPendingFlush();
        } else {
          flush();
        }
        abortControllerRef.current = null;
      }

      // 流正常结束后收尾：重拉确认落库再清空流式分段（见 reconcileHistory 注释）。
      // 注意：abort 路径会抛出 AbortError，跳过此处，流式状态由 abort() 自行清理。
      await reconcileHistory(sessionId);
    },
    onMutate: async ({ sessionId, content }) => {
      const queryKey = ['messages', sessionId];
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<SessionMessagesResponse>(queryKey);
      const messages = previous?.messages ?? [];
      const optimistic = buildOptimisticUserMessage(sessionId, content, messages);
      queryClient.setQueryData<SessionMessagesResponse>(queryKey, {
        messages: [...messages, optimistic],
      });
      return { previous };
    },
    onError: (_err, { sessionId }, context) => {
      // 请求级失败（网络/鉴权等，非单 agent 的 agent_error 事件）：回滚乐观消息，
      // 并清空可能残留的孤立流式分段——本轮无有效回合，不应留下半截 agent 输出。
      clearStreamingSegments(sessionId);
      if (context?.previous) {
        queryClient.setQueryData(['messages', sessionId], context.previous);
      }
    },
    onSettled: (_, __, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const abort = (sessionId: string) => {
    abortControllerRef.current?.abort();
    // 取消本轮：丢弃本地流式分段（回合已中止，部分输出不保留），与既有 abort 语义一致。
    clearStreamingSegments(sessionId);
  };

  return { ...mutation, abort };
}
