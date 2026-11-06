import { create } from 'zustand';
import type { AttachmentRef } from '@/lib/api';

// session-message-queue 的客户端等待状态（adapt-session-message-queue D3/D4）。
// 临时确认项：新提交收到 queued SSE 后、队列快照尚未列出它之前的本地占位——
// 快照接管后即消失，不进任何服务端读模型。刻意用 Zustand 而非 React Query：
// 写入方是发送 mutation（非组件代码），读取方是队列展示、探测判据（hints）与
// 撤回入口，都是跨组件共享的客户端状态。

/** 临时入队确认项：字段与 SessionQueueEntry 展示口径对齐。 */
export interface QueueConfirmItem {
  /** 等待项身份（= 未来执行的 run id，撤回目标）；取自 queued.meta.run_id，X-Run-Id 兜底。 */
  runId: string;
  /** 发送原文（含 additional_context 序列化块，展示侧解析剥离）。 */
  content: string;
  /** 请求携带的模型名（队列项是服务端已解析模型；确认项只能展示请求值）。 */
  model?: string;
  /** 本地确认时间（服务端入队时间的近似）。 */
  at: number;
  /** 已上传完成的图片附件引用（content 端点可直接展示）。 */
  attachments?: AttachmentRef[];
}

interface PendingQueueState {
  confirms: Record<string, QueueConfirmItem[]>;
  // 会话等待快照非空的提示（队列 hook 回写）：详情/队列有界轮询的活动判据之一
  //（D4——等待阶段必须继续探测，否则 FIFO 后续 run 的开始无法被发现）。
  hints: Record<string, boolean>;
  addConfirm: (sessionId: string, item: QueueConfirmItem) => void;
  /** 撤回成功等即时移除：不等快照接管。 */
  removeConfirm: (sessionId: string, runId: string) => void;
  /** 快照接管：保留谓词为假的确认项全部丢弃（在快照中 / 宽限期内 / 仍在等待）。 */
  pruneConfirms: (sessionId: string, keep: (item: QueueConfirmItem) => boolean) => void;
  setHint: (sessionId: string, active: boolean) => void;
  /** 会话删除等全局清理。 */
  clearSession: (sessionId: string) => void;
}

export const usePendingQueueStore = create<PendingQueueState>()((set) => ({
  confirms: {},
  hints: {},
  addConfirm: (sessionId, item) =>
    set((s) => ({
      confirms: { ...s.confirms, [sessionId]: [...(s.confirms[sessionId] ?? []), item] },
    })),
  removeConfirm: (sessionId, runId) =>
    set((s) => {
      const list = s.confirms[sessionId];
      if (!list?.some((item) => item.runId === runId)) return {};
      return {
        confirms: {
          ...s.confirms,
          [sessionId]: list.filter((item) => item.runId !== runId),
        },
      };
    }),
  pruneConfirms: (sessionId, keep) =>
    set((s) => {
      const list = s.confirms[sessionId];
      if (!list) return {};
      const kept = list.filter(keep);
      if (kept.length === list.length) return {};
      return { confirms: { ...s.confirms, [sessionId]: kept } };
    }),
  setHint: (sessionId, active) =>
    set((s) => (s.hints[sessionId] === active ? {} : { hints: { ...s.hints, [sessionId]: active } })),
  clearSession: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.confirms) && !(sessionId in s.hints)) return {};
      const confirms = { ...s.confirms };
      const hints = { ...s.hints };
      delete confirms[sessionId];
      delete hints[sessionId];
      return { confirms, hints };
    }),
}));
