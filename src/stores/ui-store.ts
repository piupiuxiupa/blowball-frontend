import { create } from 'zustand';

export type AgentStatus = 'idle' | 'running' | 'tool_call' | 'error';

// 流式按 agent 分段：每个 agent_start 开启一段，token/reasoning/tool_call 追加到对应段，
// 使流式期间即按 agent 分隔展示，不再等回合结束才切分。段仅追加、不重排。
export interface StreamingSegment {
  // 创建时分配的单调 id，用作稳定 React key——新段到达不会让已渲染段错位或重挂载。
  id: string;
  agent: string;
  content: string;
  reasoning: string;
  toolCalls: string[];
  status: AgentStatus;
  isError?: boolean;
}

// 文件查看模式：默认「只读」(view)，切到「编辑」(edit) 后 Monaco 可写并暴露保存入口。
// 与 activeFilePath 对称地放在 ui-store；**跨文件粘住**——切换活动文件不重置模式
// （切走的拦截由 dirty 态负责，见 file-edit-store / dirty-guard-dialog）。
// Office 文件经 OnlyOffice 自身渲染，但同样读取此值决定 edit/view（见 office-viewer）。
export type FileViewMode = 'view' | 'edit';

interface UIState {
  activeSessionId: string | null;
  activeFilePath: string | null;
  fileViewMode: FileViewMode;
  // 版本历史抽屉开合（编辑器右侧、可折叠）。按活动文件加载版本列表。
  versionDrawerOpen: boolean;
  // 当前在主编辑区只读预览的历史版本 id；null = 正常编辑/查看态。
  // 切换活动文件时清空（见 setActiveFile）。
  previewVersionId: string | null;
  sidebarCollapsed: boolean;
  showHiddenFiles: boolean;
  streamingSegments: Record<string, StreamingSegment[]>;

  setActiveSession: (id: string | null) => void;
  setActiveFile: (path: string | null) => void;
  setFileViewMode: (mode: FileViewMode) => void;
  setVersionDrawerOpen: (open: boolean) => void;
  setPreviewVersionId: (id: string | null) => void;
  toggleSidebar: () => void;
  toggleShowHiddenFiles: () => void;
  startAgentSegment: (sessionId: string, agent: string) => void;
  appendSegmentContent: (sessionId: string, agent: string, chunk: string) => void;
  appendSegmentReasoning: (sessionId: string, agent: string, chunk: string) => void;
  pushSegmentToolCall: (sessionId: string, agent: string, content: string) => void;
  setSegmentStatus: (sessionId: string, agent: string, status: AgentStatus) => void;
  clearStreamingSegments: (sessionId: string) => void;
}

// 段 id 单调计数器（模块级，跨会话/回合持续递增）。段仅追加、不重排，故 id 用作稳定 key。
let segmentIdCounter = 0;
function nextSegmentId(): string {
  segmentIdCounter += 1;
  return `seg-${segmentIdCounter}`;
}

// 在数组中从末尾向前找该 agent 的段：requireActive=true 时只匹配仍处 running/tool_call
// 的活动段（用于 token/reasoning/tool_call 路由），否则匹配该 agent 的最后一段（用于状态置位）。
// 返回该段下标，找不到返回 -1。
function findSegmentIndex(
  segments: StreamingSegment[],
  agent: string,
  requireActive: boolean,
): number {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (
      seg.agent === agent &&
      (!requireActive || seg.status === 'running' || seg.status === 'tool_call')
    ) {
      return i;
    }
  }
  return -1;
}

export const useUIStore = create<UIState>((set) => ({
  activeSessionId: null,
  activeFilePath: null,
  fileViewMode: 'view',
  versionDrawerOpen: false,
  previewVersionId: null,
  sidebarCollapsed: false,
  // 默认隐藏以「.」开头的条目（.git/.codegraph 等），保持工作空间整洁；按需在
  // 文件树头部用眼睛按钮切换显示。过滤在各层级生效（含已展开子目录）。
  showHiddenFiles: false,
  streamingSegments: {},

  setActiveSession: (id) => set({ activeSessionId: id }),
  // 切换活动文件时一并退出版本预览（预览绑定的是旧文件的历史版本）。
  setActiveFile: (path) => set({ activeFilePath: path, previewVersionId: null }),
  setFileViewMode: (mode) => set({ fileViewMode: mode }),
  setVersionDrawerOpen: (open) => set({ versionDrawerOpen: open }),
  setPreviewVersionId: (id) => set({ previewVersionId: id }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleShowHiddenFiles: () => set((state) => ({ showHiddenFiles: !state.showHiddenFiles })),

  // agent_start：push 新段、分配单调 id、置 running。活动段即数组末尾。
  // 若该 agent 已有活动段（如 token 先于 agent_start 惰性建段），复用它而非再 push——
  // 否则会产生重复的孤立 running 段（无人置 idle 关闭）。
  startAgentSegment: (sessionId, agent) =>
    set((state) => {
      const prev = state.streamingSegments[sessionId] ?? [];
      if (findSegmentIndex(prev, agent, true) >= 0) return {};
      const seg: StreamingSegment = {
        id: nextSegmentId(),
        agent,
        content: '',
        reasoning: '',
        toolCalls: [],
        status: 'running',
      };
      return {
        streamingSegments: {
          ...state.streamingSegments,
          [sessionId]: [...prev, seg],
        },
      };
    }),

  // token 追加：路由到该 agent 的活动段。无活动段（token 先于 agent_start，或上一段已结束）
  // 时惰性建段（对齐 groupMessages 兜底），确保 token 不丢失、不串入其他 agent 段。
  appendSegmentContent: (sessionId, agent, chunk) => {
    if (!chunk) return;
    set((state) => {
      const prev = state.streamingSegments[sessionId] ?? [];
      const idx = findSegmentIndex(prev, agent, true);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = { ...next[idx], content: next[idx].content + chunk };
        return { streamingSegments: { ...state.streamingSegments, [sessionId]: next } };
      }
      const created: StreamingSegment = {
        id: nextSegmentId(),
        agent,
        content: chunk,
        reasoning: '',
        toolCalls: [],
        status: 'running',
      };
      return {
        streamingSegments: { ...state.streamingSegments, [sessionId]: [...prev, created] },
      };
    });
  },

  // reasoning 追加：同 content 的活动段路由 + 惰性建段逻辑。
  appendSegmentReasoning: (sessionId, agent, chunk) => {
    if (!chunk) return;
    set((state) => {
      const prev = state.streamingSegments[sessionId] ?? [];
      const idx = findSegmentIndex(prev, agent, true);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = { ...next[idx], reasoning: next[idx].reasoning + chunk };
        return { streamingSegments: { ...state.streamingSegments, [sessionId]: next } };
      }
      const created: StreamingSegment = {
        id: nextSegmentId(),
        agent,
        content: '',
        reasoning: chunk,
        toolCalls: [],
        status: 'running',
      };
      return {
        streamingSegments: { ...state.streamingSegments, [sessionId]: [...prev, created] },
      };
    });
  },

  // tool_call：记入活动段 toolCalls 并置 tool_call 状态。无活动段时同样惰性建段，避免丢失。
  pushSegmentToolCall: (sessionId, agent, content) => {
    if (!content) return;
    set((state) => {
      const prev = state.streamingSegments[sessionId] ?? [];
      const idx = findSegmentIndex(prev, agent, true);
      if (idx >= 0) {
        const next = prev.slice();
        const seg = next[idx];
        next[idx] = { ...seg, toolCalls: [...seg.toolCalls, content], status: 'tool_call' };
        return { streamingSegments: { ...state.streamingSegments, [sessionId]: next } };
      }
      const created: StreamingSegment = {
        id: nextSegmentId(),
        agent,
        content: '',
        reasoning: '',
        toolCalls: [content],
        status: 'tool_call',
      };
      return {
        streamingSegments: { ...state.streamingSegments, [sessionId]: [...prev, created] },
      };
    });
  },

  // 状态置位：agent_end→idle、agent_error→error/isError、tool_call→tool_call。
  // 定位该 agent 的最后一段（不限活动态），找不到则忽略（无对应段的状态事件属异常边界）。
  setSegmentStatus: (sessionId, agent, status) =>
    set((state) => {
      const prev = state.streamingSegments[sessionId] ?? [];
      const idx = findSegmentIndex(prev, agent, false);
      if (idx < 0) return {};
      const next = prev.slice();
      const seg = next[idx];
      next[idx] = {
        ...seg,
        status,
        isError: status === 'error' ? true : seg.isError,
      };
      return { streamingSegments: { ...state.streamingSegments, [sessionId]: next } };
    }),

  // 回合结束、持久化历史确认落库后清空该会话分段，交由持久化消息块接管渲染。
  clearStreamingSegments: (sessionId) =>
    set((state) => {
      if (!state.streamingSegments[sessionId]) return {};
      const next = { ...state.streamingSegments };
      delete next[sessionId];
      return { streamingSegments: next };
    }),
}));
