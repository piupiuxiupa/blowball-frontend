import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPostStream, ApiRequestError } from '@/lib/api';
import { parseSSEStream } from '@/lib/sse';
import { classifyTurnStart } from '@/lib/turn-stream';
import { attachToRun, startRunOutput } from '@/hooks/use-turn-lifecycle';
import { useAuthStore } from '@/stores/auth-store';
import { usePendingQueueStore } from '@/stores/pending-queue-store';
import type { AttachmentItem, QuotedReference } from '@/lib/additional-context';
import type { PendingImageAttachment } from '@/hooks/use-image-attachment-upload';
import type {
  SendMessageRequest,
  SessionMessagesResponse,
  Message,
  ReasoningEffort,
  AttachmentRef,
} from '@/lib/api';

// 发送路径：提交确认（POST /messages 首个有效 SSE 的分类）+ 乐观用户消息。
// adapt-session-message-queue D2：mutation 只覆盖提交确认——queued 确认后 detach
// 等待连接（不取消服务端等待项），立即执行则把首帧与剩余迭代器交给独立 run 生命
// 周期（use-turn-lifecycle 的 startRunOutput），本 mutation 随即 resolve。长期执行
// 的收尾（reconcile/回落/条件清理）由生命周期按 (session, run) 身份持有。
// turn 生命周期语义（turn-detach-resume）：断开连接不再取消 turn；停止按钮走
// cancelTurn（见 use-turn-lifecycle），本地 abort 仅为 detach。

function buildOptimisticUserMessage(
  sessionId: string,
  content: string,
  messages: Message[],
  imageAttachments?: AttachmentRef[]
): Message {
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
    // add-image-attachments：上传先于发送完成（D1 顺序），乐观消息直接携带真实
    // 附件引用——与落库行同构，渲染与 reconcile 均无需换源。
    ...(imageAttachments && imageAttachments.length > 0 ? { attachments: imageAttachments } : {}),
  };
}

/** 提交确认结果：queued=已接受等待执行；immediate=已接受立即执行。 */
export type SubmitAcceptance = { accepted: 'queued' | 'immediate'; runId: string | null };

export function useSendMessage() {
  const queryClient = useQueryClient();
  const { token } = useAuthStore();

  const mutation = useMutation({
    mutationFn: async ({
      sessionId,
      content,
      model,
      reasoningEffort,
      attachmentIds,
      imageAttachments,
    }: {
      sessionId: string;
      content: string;
      // message-context-mentions：提交时的正文、附件与划词引用快照（content 是序列化
      // 后的全量文本，不能回灌 textarea）——输入区据快照做接受后的清空匹配（D1：
      // 服务端接受 + 草稿未修订才清空，失败从不清空、无需恢复）。
      text: string;
      items: AttachmentItem[];
      references: QuotedReference[];
      // add-image-attachments：发送时已上传完成的附件 id 与引用（请求体 attachment_ids）。
      // images 是待发送图片快照——接受后仅在与当前草稿匹配时释放预览（同 text/items）。
      attachmentIds?: string[];
      imageAttachments?: AttachmentRef[];
      images?: PendingImageAttachment[];
      // per-request-model:可选的模型目录选择与思考等级;缺省不发参数,由后端按
      // agents.<name>.model 配置与目录条目派生。
      model?: string;
      reasoningEffort?: ReasoningEffort;
    }): Promise<SubmitAcceptance> => {
      if (!token) throw new Error('Not authenticated');

      const controller = new AbortController();
      const response = await apiPostStream(
        `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          body: {
            content,
            ...(model ? { model } : {}),
            ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
            ...(attachmentIds && attachmentIds.length > 0
              ? { attachment_ids: attachmentIds }
              : {}),
          } as SendMessageRequest,
          token,
          signal: controller.signal,
        }
      );

      // X-Run-Id 响应头是身份兜底渠道（跨域未暴露该头时由首帧 meta.run_id 补）。
      // 注意：头本身不写 turnRuns——queued 的头是未来 run 的身份而非当前活跃 run，
      // 立即执行的身份登记在 startRunOutput 入口（D2：处理必须位于兜底登记之前）。
      const headerRunId = response.headers.get('X-Run-Id');

      // 200 即服务端已接受：读首个有效事件区分 queued / 立即执行（D2）。
      let classified;
      try {
        classified = await classifyTurnStart(parseSSEStream(response));
      } catch (err) {
        // 接受后连接异常（D7）：这是订阅问题而非未发送——不重发 POST、不回滚乐观
        // 消息。有头身份则直接转 attach 恢复（完整重放，本条流已不可读）；无身份
        // 交给 run 发现（详情/列表探测）。
        if (headerRunId) {
          void attachToRun(sessionId, headerRunId);
          return { accepted: 'immediate', runId: headerRunId };
        }
        throw err;
      }
      const { start, iterator, firstEvent } = classified;
      // empty（无有效事件）与 execution 同路：以头兜底身份交给生命周期——
      // 迭代器已尽即立刻终局收尾（reconcile），无注册时无副作用。
      const startRunId = start.kind === 'empty' ? null : start.runId;

      if (start.kind === 'queued') {
        // meta.run_id 优先、响应头兜底标识等待项（spec）；不登记为活跃 run、不建段。
        const runId = start.runId ?? headerRunId ?? '';
        usePendingQueueStore.getState().addConfirm(sessionId, {
          runId,
          content,
          model,
          at: Date.now(),
          ...(imageAttachments && imageAttachments.length > 0
            ? { attachments: imageAttachments }
            : {}),
        });
        // 确认后 detach 等待连接：仅断开本端 SSE，不发 cancel、不走请求失败恢复
        //（服务端等待项继续，队列读模型 + 探测负责后续衔接）。
        controller.abort();
        void iterator.return?.().catch(() => undefined);
        // 入队即时刷新（D4）：队列/详情/列表（queued_count 徽标）。
        void queryClient.invalidateQueries({ queryKey: ['session-queue', sessionId] });
        void queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
        void queryClient.invalidateQueries({ queryKey: ['sessions'] });
        return { accepted: 'queued', runId: runId || null };
      }

      // 立即执行（或空流）：首帧 + 剩余迭代器交给独立生命周期（登记活跃 run，
      // 消费到终局），mutation 到此完成提交确认。
      const runId = startRunId ?? headerRunId ?? '';
      startRunOutput(sessionId, runId, iterator, firstEvent);
      return { accepted: 'immediate', runId: runId || null };
    },
    onMutate: async ({ sessionId, content, imageAttachments }) => {
      const queryKey = ['messages', sessionId];
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<SessionMessagesResponse>(queryKey);
      const messages = previous?.messages ?? [];
      const optimistic = buildOptimisticUserMessage(
        sessionId,
        content,
        messages,
        imageAttachments
      );
      queryClient.setQueryData<SessionMessagesResponse>(queryKey, {
        messages: [...messages, optimistic],
      });
      // 上下文只带乐观行 id：失败/queued 收尾都按 id 定点移除，不再保存整份快照
      //（spec：失败不回滚整份历史——并发 refetch 期间回滚快照会覆盖新数据）。
      return { optimisticId: optimistic.id };
    },
    onSuccess: (result, { sessionId }, context) => {
      // queued 接受：等待用户行直到开始执行才进入消息历史——乐观用户行定点移除
      //（按 id，不回滚整份快照），展示交由输入区上方的待处理区（D3）。
      if (result?.accepted === 'queued' && context?.optimisticId != null) {
        queryClient.setQueryData<SessionMessagesResponse>(['messages', sessionId], (prev) =>
          prev
            ? { messages: prev.messages?.filter((m) => m.id !== context.optimisticId) ?? [] }
            : prev
        );
      }
    },
    onError: (err, { sessionId }, context) => {
      // 请求级失败（网络/409/400 等，消息未被后端接受）：定点移除本条乐观用户行——
      // 不回滚整份历史快照、不清正在执行的流（spec：排队提交失败不污染当前运行或
      // 新草稿）。失败原因展示与输入保留由输入区负责（非弹窗提示，D7）。
      if (context?.optimisticId != null) {
        queryClient.setQueryData<SessionMessagesResponse>(['messages', sessionId], (prev) =>
          prev
            ? { messages: prev.messages?.filter((m) => m.id !== context.optimisticId) ?? [] }
            : prev
        );
      }
      // 409 撞忙（队列关闭部署的兼容路径）：消息未被后端接受，但 body 携带运行中
      // turn 的 run id——静默转 attach 接入该 turn（此处乐观消息已移除，输入保留）。
      if (err instanceof ApiRequestError && err.code === 'SESSION_BUSY' && err.runId) {
        void attachToRun(sessionId, err.runId);
      }
    },
    onSettled: () => {
      // 列表刷新（generating 徽标/queued_count）。messages 不在此失效：立即执行的
      // 乐观用户行要稳定展示到终局 reconcile 重拉为止（中途失效会在用户行落库前
      // 抹掉乐观行，造成气泡闪断）；queued 路径无新增历史行。
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  return mutation;
}
