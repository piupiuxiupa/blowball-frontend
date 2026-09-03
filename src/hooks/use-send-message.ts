import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { apiPostStream, ApiRequestError } from '@/lib/api';
import { consumeTurnStream, reconcileTurnHistory, clearTurnStreamState } from '@/lib/turn-stream';
import { attachToRun } from '@/hooks/use-turn-lifecycle';
import { useAuthStore } from '@/stores/auth-store';
import { useUIStore } from '@/stores/ui-store';
import type { AttachmentItem, QuotedReference } from '@/lib/additional-context';
import type { SendMessageRequest, SessionMessagesResponse, Message, ReasoningEffort } from '@/lib/api';

// 发送路径：建立流（POST /messages）+ 乐观用户消息 + 收尾 reconcile。
// 事件消费与缓冲节流在 lib/turn-stream.ts 的共享消费函数中——发送流与 attach 流
// （use-turn-lifecycle）共用同一实现（后端两路是同一条订阅循环，帧格式一致）。
// turn 生命周期语义（turn-detach-resume）：断开连接不再取消 turn；停止按钮走
// cancelTurn（见 use-turn-lifecycle），本地 abort 仅为 detach。

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
  const { setTurnRun, clearStreamingSegments } = useUIStore();
  const abortControllerRef = useRef<AbortController | null>(null);

  const mutation = useMutation({
    mutationFn: async ({
      sessionId,
      content,
      model,
      reasoningEffort,
    }: {
      sessionId: string;
      content: string;
      // message-context-mentions：提交时的正文、附件与划词引用快照（content 是序列化
      // 后的全量文本，不能回灌 textarea）——请求级失败时输入区据快照恢复正文与 chips。
      text: string;
      items: AttachmentItem[];
      references: QuotedReference[];
      // per-request-model:可选的模型目录选择与思考等级;缺省不发参数,由后端按
      // agents.<name>.model 配置与目录条目派生。
      model?: string;
      reasoningEffort?: ReasoningEffort;
    }) => {
      if (!token) throw new Error('Not authenticated');

      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      try {
        const response = await apiPostStream(
          `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
          {
            body: {
              content,
              ...(model ? { model } : {}),
              ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
            } as SendMessageRequest,
            token,
            signal,
          }
        );

        // 记录本 turn 的 run id（= trace id）：取消目标 / 输入禁用判据 / attach 防重
        // 都读它。X-Run-Id 响应头是主渠道（跨域未暴露该头时由消费循环从首个事件的
        // meta.run_id 兜底补记，见 turn-stream.ts）。
        const headerRunId = response.headers.get('X-Run-Id');
        if (headerRunId) setTurnRun(sessionId, headerRunId);

        // 消费到流关闭（后端在终局事件后关流；显式取消也经此路径收尾——取消后
        // 部分输出会持久化，收尾走 reconcile 而非丢弃）。
        await consumeTurnStream(sessionId, response, signal);

        // 流正常结束后收尾：重拉确认落库再清空流式分段（见 reconcileTurnHistory 注释）。
        // 注意：detach 路径会抛出 AbortError，跳过此处，流式状态保留给后续 attach。
        await reconcileTurnHistory(sessionId);
      } finally {
        // 请求级失败（409/网络等）或正常终局后清除本端 turn 登记；409 的转 attach
        // 在 onError 里做（需先经 onError 回滚乐观消息），时序在本 finally 之后。
        setTurnRun(sessionId, null);
        clearTurnStreamState(sessionId);
        abortControllerRef.current = null;
      }
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
    onError: (err, { sessionId }, context) => {
      // 请求级失败（网络/鉴权等，非单 agent 的 agent_error 事件）：回滚乐观消息，
      // 并清空可能残留的孤立流式分段——本轮无有效回合，不应留下半截 agent 输出。
      clearStreamingSegments(sessionId);
      if (context?.previous) {
        queryClient.setQueryData(['messages', sessionId], context.previous);
      }
      // 409 撞忙：消息未被后端接受，但 body 携带运行中 turn 的 run id——静默转
      // attach 接入该 turn（此处乐观消息已回滚，与本轮发送无交集）。
      if (err instanceof ApiRequestError && err.code === 'SESSION_BUSY' && err.runId) {
        void attachToRun(sessionId, err.runId);
        return;
      }
      // 模型/思考等级选择被拒（per-request-model）：目录外名称、非思考模型上非 none
      // 等级、或部署未配置目录。必须显式告知用户原因,否则表现为「消息发不出去」。
      if (
        err instanceof ApiRequestError &&
        (err.code === 'INVALID_MODEL' || err.code === 'INVALID_EFFORT')
      ) {
        alert(`消息被拒绝：${err.message}`);
      }
    },
    onSettled: (_, __, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  // 仅 detach：断开本端订阅（turn 在服务端继续跑完，断开不再取消——turn-detach-resume
  // 契约）。不清流式分段、不回滚乐观消息；语义上供组件清理/会话删除等路径使用，
  // 停止按钮走 cancelTurn（use-turn-lifecycle）而非这里。
  const abort = () => {
    abortControllerRef.current?.abort();
  };

  return { ...mutation, abort };
}
