import { create } from 'zustand';

export type AgentStatus = 'idle' | 'running' | 'tool_call' | 'error';

interface UIState {
  activeSessionId: string | null;
  activeFilePath: string | null;
  sidebarCollapsed: boolean;
  streamingTokens: Record<string, string>;
  streamingReasoningTokens: Record<string, string>;
  agentStatus: Record<string, { agent: string; status: AgentStatus }>;

  setActiveSession: (id: string | null) => void;
  setActiveFile: (path: string | null) => void;
  toggleSidebar: () => void;
  appendTokenBatch: (sessionId: string, chunk: string) => void;
  clearStreaming: (sessionId: string) => void;
  appendReasoningTokenBatch: (sessionId: string, chunk: string) => void;
  clearStreamingReasoning: (sessionId: string) => void;
  setAgentStatus: (sessionId: string, agent: string, status: AgentStatus) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeSessionId: null,
  activeFilePath: null,
  sidebarCollapsed: false,
  streamingTokens: {},
  streamingReasoningTokens: {},
  agentStatus: {},

  setActiveSession: (id) => set({ activeSessionId: id }),
  setActiveFile: (path) => set({ activeFilePath: path }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
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
