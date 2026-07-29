import { create } from 'zustand';

export type AgentStatus = 'idle' | 'running' | 'tool_call' | 'error';

// 文件查看模式：默认「只读」(view)，切到「编辑」(edit) 后 Monaco 可写并暴露保存入口。
// 与 activeFilePath 对称地放在 ui-store；**跨文件粘住**——切换活动文件不重置模式
// （切走的拦截由 dirty 态负责，见 file-edit-store / dirty-guard-dialog）。
// Office 文件经 OnlyOffice 自身渲染，但同样读取此值决定 edit/view（见 office-viewer）。
export type FileViewMode = 'view' | 'edit';

interface UIState {
  activeSessionId: string | null;
  activeFilePath: string | null;
  fileViewMode: FileViewMode;
  sidebarCollapsed: boolean;
  showHiddenFiles: boolean;
  streamingTokens: Record<string, string>;
  streamingReasoningTokens: Record<string, string>;
  agentStatus: Record<string, { agent: string; status: AgentStatus }>;

  setActiveSession: (id: string | null) => void;
  setActiveFile: (path: string | null) => void;
  setFileViewMode: (mode: FileViewMode) => void;
  toggleSidebar: () => void;
  toggleShowHiddenFiles: () => void;
  appendTokenBatch: (sessionId: string, chunk: string) => void;
  clearStreaming: (sessionId: string) => void;
  appendReasoningTokenBatch: (sessionId: string, chunk: string) => void;
  clearStreamingReasoning: (sessionId: string) => void;
  setAgentStatus: (sessionId: string, agent: string, status: AgentStatus) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeSessionId: null,
  activeFilePath: null,
  fileViewMode: 'view',
  sidebarCollapsed: false,
  // 默认隐藏以「.」开头的条目（.git/.codegraph 等），保持工作空间整洁；按需在
  // 文件树头部用眼睛按钮切换显示。过滤在各层级生效（含已展开子目录）。
  showHiddenFiles: false,
  streamingTokens: {},
  streamingReasoningTokens: {},
  agentStatus: {},

  setActiveSession: (id) => set({ activeSessionId: id }),
  setActiveFile: (path) => set({ activeFilePath: path }),
  setFileViewMode: (mode) => set({ fileViewMode: mode }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleShowHiddenFiles: () => set((state) => ({ showHiddenFiles: !state.showHiddenFiles })),
  // 一次 set 追加整段 chunk，供 rAF 批量节流调用，避免逐 token 触发渲染。
  appendTokenBatch: (sessionId, chunk) => {
    if (!chunk) return;
    set((state) => ({
      streamingTokens: {
        ...state.streamingTokens,
        [sessionId]: (state.streamingTokens[sessionId] ?? '') + chunk,
      },
    }));
  },
  clearStreaming: (sessionId) =>
    set((state) => {
      const next = { ...state.streamingTokens };
      delete next[sessionId];
      return { streamingTokens: next };
    }),
  // 同上：reasoning token 的批量版本。
  appendReasoningTokenBatch: (sessionId, chunk) => {
    if (!chunk) return;
    set((state) => ({
      streamingReasoningTokens: {
        ...state.streamingReasoningTokens,
        [sessionId]: (state.streamingReasoningTokens[sessionId] ?? '') + chunk,
      },
    }));
  },
  clearStreamingReasoning: (sessionId) =>
    set((state) => {
      const next = { ...state.streamingReasoningTokens };
      delete next[sessionId];
      return { streamingReasoningTokens: next };
    }),
  setAgentStatus: (sessionId, agent, status) =>
    set((state) => ({
      agentStatus: {
        ...state.agentStatus,
        [sessionId]: { agent, status },
      },
    })),
}));
