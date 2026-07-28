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
  const { appendTokenBatch, appendReasoningTokenBatch, clearStreaming, clearStreamingReasoning, setAgentStatus } = useUIStore();
  const abortControllerRef = useRef<AbortController | null>(null);

  // 收尾重拉：助手整段回复在流式期间只存在于 streamingTokens，并不在消息缓存里。
  // `done` 事件可能早于后端把这一轮写库到达——若此时立刻清空流式缓冲，回复会在
  // 历史重取完成前消失；重取若因写入延迟返回空/旧数据，整个聊天区会暂时为空，
  // 直到刷新页面才会恢复。这里反复重拉持久化历史，直到消息数超过发送前快照
  // （说明这一轮已落库）再清空流式状态；多次仍未增长则兜底清空，避免流式尾巴残留。
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
    clearStreaming(sessionId);
    clearStreamingReasoning(sessionId);
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
      // 收尾事件（done / agent_error / 异常 / abort）会同步 flush 剩余缓冲，
      // 避免丢失尾部 token；取消时也确保 rAF 句柄被回收，防止泄漏。
      let tokenBuffer = '';
      let reasoningBuffer = '';
      let rafId: number | null = null;

      const flush = () => {
        if (rafId != null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (tokenBuffer) {
          appendTokenBatch(sessionId, tokenBuffer);
          tokenBuffer = '';
        }
        if (reasoningBuffer) {
          appendReasoningTokenBatch(sessionId, reasoningBuffer);
          reasoningBuffer = '';
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
              setAgentStatus(sessionId, payload.agent, 'running');
              break;
            case 'token':
              tokenBuffer += payload.content ?? '';
              scheduleFlush();
              break;
            case 'reasoning':
              reasoningBuffer += payload.content ?? '';
              scheduleFlush();
              break;
            case 'tool_call':
              setAgentStatus(sessionId, payload.agent, 'tool_call');
              break;
            case 'agent_end':
              setAgentStatus(sessionId, payload.agent, 'idle');
              break;
            case 'agent_error':
              // 出错时先同步 flush，确保已收到的尾部 token 不丢失、不截断。
              flush();
              setAgentStatus(sessionId, payload.agent, 'error');
              break;
            case 'done':
              // 仅同步 flush 剩余缓冲；流式状态的清空交给流结束后的 reconcileHistory，
              // 由它确认这一轮已落库后再清，避免回复在历史重取前消失。
              flush();
              break;
          }
        }
      } finally {
        // 兜底：流彻底结束（含 abort 抛出的 AbortError / 意外断流）时同步 flush
        // 并回收 rAF 句柄，避免残留回调在清理后再次写入状态。
        flush();
        abortControllerRef.current = null;
      }

      // 流正常结束后收尾：重拉确认落库再清空流式缓冲（见 reconcileHistory 注释）。
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
      setAgentStatus(sessionId, 'system', 'error');
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
    clearStreaming(sessionId);
    clearStreamingReasoning(sessionId);
    setAgentStatus(sessionId, 'system', 'idle');
  };

  return { ...mutation, abort };
}
