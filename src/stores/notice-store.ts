import { create } from 'zustand';

// 非弹窗临时提示（adapt-session-message-queue D7：QUEUE_FULL、SESSION_BUSY 兼容、
// 请求拒绝原因与撤回结果都以非弹窗方式说明，保留输入/等待现场）。单例共享，
// 渲染入口 InlineNotices（输入区上方）；自动过期由渲染方按 id 定时移除。

export interface InlineNotice {
  id: number;
  text: string;
  tone: 'error' | 'info';
}

interface NoticeState {
  notices: InlineNotice[];
  push: (text: string, tone?: InlineNotice['tone']) => void;
  dismiss: (id: number) => void;
}

let noticeId = 0;

export const useNoticeStore = create<NoticeState>()((set) => ({
  notices: [],
  push: (text, tone = 'error') =>
    set((s) => ({ notices: [...s.notices, { id: ++noticeId, text, tone }] })),
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
}));
