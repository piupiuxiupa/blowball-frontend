import { create } from 'zustand';
import type { ArtifactInfo } from '@/lib/api';
import type { ReasoningEffort } from '@/lib/api';
import {
  appendTimelinePlan,
  appendTimelineText,
  appendTimelineTool,
  attachTimelineToolResult,
  type MessageTimelineItem,
  type TimelineToolOptions,
} from '@/lib/message-timeline';

export type AgentStatus = 'idle' | 'running' | 'tool_call' | 'error';

// 草稿会话哨兵（lazy-session-creation）：activeSessionId === DRAFT_SESSION_ID 表示
// 「新建但未落库」的会话——点「+」仅本地建立,首条消息发送时才真实创建。
// 不变量:哨兵只存在于 activeSessionId,绝不进任何 API 路径,也不进
// turnRuns / streamingSegments / ['messages', ...] 的键空间(发送前必已替换为
// 真实 id)。唯一需要显式排除的是读取侧:use-messages 的 enabled。
export const DRAFT_SESSION_ID = 'draft';

// 流式按 agent + 线程身份分段：动态子 Agent 优先 (agent, agentInstanceId)，同一
// 实例的多次 resume 归并到同一条线程；存量事件没有实例身份时退化为 runId。
// 每个 agent_start 开启或唤醒一段，token/reasoning/tool_call
// 追加到对应段的 timeline，使流式期间即按 agent 分隔且段内保序展示，不再等回合结束才切分。
// 段仅追加、不重排。
// runId 取自事件的 meta.parent_tool_call_id，保留本次执行身份；并发同名子 Agent
// 调用有不同实例身份，各自成段、互不串文；顶层事件身份为空串，退化为按 agent
// 名路由的旧行为。
export interface StreamingSegment {
  // 创建时分配的单调 id，用作稳定 React key——新段到达不会让已渲染段错位或重挂载。
  id: string;
  agent: string;
  // 本次 dispatch 的 run 身份（父 spawn tool_call id）；空串 = 无身份（顶层回合）。
  runId: string;
  // 跨 resume 稳定的动态子 Agent 实例身份；空串 = 存量事件/顶层回合。
  agentInstanceId: string;
  content: string;
  reasoning: string;
  // 正文片段与工具记录的事件序列。content 仍保留聚合文本便于兼容/诊断，
  // 渲染侧只读 timeline，避免把工具统一挪到正文之后。
  timeline: MessageTimelineItem[];
  status: AgentStatus;
  isError?: boolean;
}

export interface SegmentRoute {
  runId?: string;
  agentInstanceId?: string;
}

// 子 Agent 浮窗打开态（subagent-float-window design D2）：按身份解析内容——
// target 为流式段 id 或持久化块 id；agent / runId / agentInstanceId 用于
// reconcile 清段后向同身份持久化块回退。turnArtifacts / msgTime 为持久化块的
// 产物链接钉版上下文快照（块内不可变），流式段不带。
export interface OpenSubAgentWindowState {
  sessionId: string;
  agent: string;
  runId: string;
  agentInstanceId: string;
  target: { kind: 'segment' | 'block'; id: string };
  turnArtifacts?: ArtifactInfo[];
  msgTime?: string;
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
  previewVersionId: string | null;
  // 实时流暂存的本 turn 产物（done.meta.artifacts）；历史落库接管后清空
  // （见 turn-stream / reconcileTurnHistory）。
  turnArtifacts: Record<string, ArtifactInfo[]>;
  sidebarCollapsed: boolean;
  showHiddenFiles: boolean;
  streamingSegments: Record<string, StreamingSegment[]>;
  // 每会话活跃 turn 的 run id（turn-detach-resume）：发送时从 X-Run-Id 头记录、
  // 409/attach 时从 body 或列表项获得。存在即「本端正订阅该 turn」——停止按钮的
  // 取消目标、输入禁用判据、attach 防重都读它；终局/回落时置 null。
  // 最后收到的帧 id（续传用）刻意不放这里，见 lib/turn-stream.ts 的 lastEventIds。
  turnRuns: Record<string, string>;
  // 下一次发送的模型/思考等级选择（per-request-model）：null = 不发该参数、跟随后端
  // 缺省（模型按 agents.<name>.model 配置,思考按所选条目派生）。客户端状态,重载即回默认。
  selectedModel: string | null;
  selectedEffort: ReasoningEffort | null;
  // 子 Agent 浮窗（subagent-float-window）：单实例，null = 关闭。浮窗渲染在
  // ChatPanel 层（虚拟列表外），滚动聊天不卸载；切换会话时清空。
  openSubAgentWindow: OpenSubAgentWindowState | null;

  setActiveSession: (id: string | null) => void;
  setActiveFile: (path: string | null) => void;
  setFileViewMode: (mode: FileViewMode) => void;
  setVersionDrawerOpen: (open: boolean) => void;
  setPreviewVersionId: (id: string | null) => void;
  setTurnArtifacts: (sessionId: string, artifacts: ArtifactInfo[]) => void;
  clearTurnArtifacts: (sessionId: string) => void;
  toggleSidebar: () => void;
  toggleShowHiddenFiles: () => void;
  openSubAgent: (win: OpenSubAgentWindowState) => void;
  closeSubAgentWindow: () => void;
  setTurnRun: (sessionId: string, runId: string | null) => void;
  setModelSelection: (model: string | null, effort: ReasoningEffort | null) => void;
  startAgentSegment: (sessionId: string, agent: string, route: SegmentRoute) => void;
  appendSegmentContent: (
    sessionId: string,
    agent: string,
    route: SegmentRoute,
    chunk: string
  ) => void;
  appendSegmentReasoning: (
    sessionId: string,
    agent: string,
    route: SegmentRoute,
    chunk: string
  ) => void;
  pushSegmentToolCall: (
    sessionId: string,
    agent: string,
    route: SegmentRoute,
    content: string,
    options?: TimelineToolOptions,
  ) => void;
  pushSegmentPlan: (
    sessionId: string,
    agent: string,
    route: SegmentRoute,
    content: string
  ) => void;
  setSegmentStatus: (
    sessionId: string,
    agent: string,
    route: SegmentRoute,
    status: AgentStatus
  ) => void;
  clearStreamingSegments: (sessionId: string) => void;
}

// 段 id 单调计数器（模块级，跨会话/回合持续递增）。段仅追加、不重排，故 id 用作稳定 key。
let segmentIdCounter = 0;
function nextSegmentId(): string {
  segmentIdCounter += 1;
  return `seg-${segmentIdCounter}`;
}

// 在数组中从末尾向前找该 agent + 线程身份的段。动态子 Agent 有 agentInstanceId 时，
// 已结束的段也可被 resume 唤醒（同一实例始终一条线程）；没有实例身份的存量事件仍按
// requireActive 决定是否只路由活动段。runId 缺省视同空串——顶层事件路由到无身份段。
function findSegmentIndex(
  segments: StreamingSegment[],
  agent: string,
  route: SegmentRoute | undefined,
  requireActive: boolean,
): number {
  const run = route?.runId ?? '';
  const instance = route?.agentInstanceId ?? '';
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (
      seg.agent === agent &&
      (instance ? seg.agentInstanceId === instance : seg.runId === run) &&
      (!requireActive || !!instance || seg.status === 'running' || seg.status === 'tool_call')
    ) {
      return i;
    }
  }
  return -1;
}

// 子 agent 首个事件到达时，先结束当前活动顶层段。之后顶层事件会惰性创建
// continuation 段并排在子 agent 段后，使列表顺序对应 invoke / 子 agent / result
// 的真实到达顺序；已输出的顶层前缀不会被重写或重排。
function detachActiveTopLevelSegments(segments: StreamingSegment[], runId: string) {
  if (!runId) return segments;
  return segments.map((segment) =>
    segment.runId === '' &&
    (segment.status === 'running' || segment.status === 'tool_call')
      ? { ...segment, status: 'idle' as const }
      : segment,
  );
}

export const useUIStore = create<UIState>((set) => ({
  activeSessionId: null,
  activeFilePath: null,
  fileViewMode: 'view',
  versionDrawerOpen: false,
  previewVersionId: null,
  turnArtifacts: {},
  sidebarCollapsed: false,
  // 默认隐藏以「.」开头的条目（.git/.codegraph 等），保持工作空间整洁；按需在
  // 文件树头部用眼睛按钮切换显示。过滤在各层级生效（含已展开子目录）。
  showHiddenFiles: false,
  streamingSegments: {},
  turnRuns: {},
  selectedModel: null,
  selectedEffort: null,
  openSubAgentWindow: null,

  // 切换会话同时关闭子 Agent 浮窗（spec：会话切换关闭浮窗）。
  setActiveSession: (id) => set({ activeSessionId: id, openSubAgentWindow: null }),
  // 切换活动文件时一并退出版本预览（预览绑定的是旧文件的历史版本）。
  setActiveFile: (path) => set({ activeFilePath: path, previewVersionId: null }),
  setFileViewMode: (mode) => set({ fileViewMode: mode }),
  setVersionDrawerOpen: (open) => set({ versionDrawerOpen: open }),
  setPreviewVersionId: (id) => set({ previewVersionId: id }),
  setTurnArtifacts: (sessionId, artifacts) =>
    set((state) => ({
      turnArtifacts: { ...state.turnArtifacts, [sessionId]: artifacts },
    })),
  clearTurnArtifacts: (sessionId) =>
    set((state) => {
      if (!(sessionId in state.turnArtifacts)) return {};
      const next = { ...state.turnArtifacts };
      delete next[sessionId];
      return { turnArtifacts: next };
    }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleShowHiddenFiles: () => set((state) => ({ showHiddenFiles: !state.showHiddenFiles })),

  openSubAgent: (win) => set({ openSubAgentWindow: win }),
  closeSubAgentWindow: () => set({ openSubAgentWindow: null }),

  // turn 订阅登记：runId 非空登记（取消目标/禁用判据/attach 防重），null 清除（终局/回落）。
  setTurnRun: (sessionId, runId) =>
    set((state) => {
      if (!runId) {
        if (!state.turnRuns[sessionId]) return {};
        const next = { ...state.turnRuns };
        delete next[sessionId];
        return { turnRuns: next };
      }
      return { turnRuns: { ...state.turnRuns, [sessionId]: runId } };
    }),

  setModelSelection: (model, effort) => set({ selectedModel: model, selectedEffort: effort }),

  // agent_start：push 新段或唤醒同实例旧段，并置 running。若同线路已有活动段
  // （如 token 先到），复用它而非再 push，避免重复孤立段。动态子 Agent resume 时，
  // 旧段已 idle 也复用并更新 runId，使一个实例始终呈现为一条线程。
  startAgentSegment: (sessionId, agent, route) =>
    set((state) => {
      const prev = state.streamingSegments[sessionId] ?? [];
      const routed = route.agentInstanceId
        ? detachActiveTopLevelSegments(prev, route.runId ?? '')
        : prev;
      const idx = findSegmentIndex(routed, agent, route, true);
      if (idx >= 0) {
        const next = routed.slice();
        next[idx] = {
          ...next[idx],
          runId: route.runId ?? '',
          status: 'running',
        };
        return { streamingSegments: { ...state.streamingSegments, [sessionId]: next } };
      }
      const base = detachActiveTopLevelSegments(routed, route.runId ?? '');
      const seg: StreamingSegment = {
        id: nextSegmentId(),
        agent,
        runId: route.runId ?? '',
        agentInstanceId: route.agentInstanceId ?? '',
        content: '',
        reasoning: '',
        timeline: [],
        status: 'running',
      };
      return {
        streamingSegments: {
          ...state.streamingSegments,
          [sessionId]: [...base, seg],
        },
      };
    }),

  // token 追加：按线程身份路由。无活动段（token 先于 agent_start，或存量 run 已结束）
  // 时惰性建段；动态实例则优先并入同实例旧段，resume 不产生第二条气泡。
  appendSegmentContent: (sessionId, agent, route, chunk) => {
    if (!chunk) return;
    set((state) => {
      const prev = state.streamingSegments[sessionId] ?? [];
      const routed = route.agentInstanceId
        ? detachActiveTopLevelSegments(prev, route.runId ?? '')
        : prev;
      const idx = findSegmentIndex(routed, agent, route, true);
      const base = idx >= 0 ? routed : detachActiveTopLevelSegments(routed, route.runId ?? '');
      if (idx >= 0) {
        const next = routed.slice();
        const seg = next[idx];
        next[idx] = {
          ...seg,
          runId: route.runId || seg.runId,
          content: seg.content + chunk,
          timeline: appendTimelineText(seg.timeline, chunk),
        };
        return { streamingSegments: { ...state.streamingSegments, [sessionId]: next } };
      }
      const created: StreamingSegment = {
        id: nextSegmentId(),
        agent,
        runId: route.runId ?? '',
        agentInstanceId: route.agentInstanceId ?? '',
        content: chunk,
        reasoning: '',
        timeline: [{ type: 'text', content: chunk }],
        status: 'running',
      };
      return {
        streamingSegments: { ...state.streamingSegments, [sessionId]: [...base, created] },
      };
    });
  },

  // reasoning 追加：同 content 的活动段路由 + 惰性建段逻辑。
  appendSegmentReasoning: (sessionId, agent, route, chunk) => {
    if (!chunk) return;
    set((state) => {
      const prev = state.streamingSegments[sessionId] ?? [];
      const routed = route.agentInstanceId
        ? detachActiveTopLevelSegments(prev, route.runId ?? '')
        : prev;
      const idx = findSegmentIndex(routed, agent, route, true);
      const base = idx >= 0 ? routed : detachActiveTopLevelSegments(routed, route.runId ?? '');
      if (idx >= 0) {
        const next = routed.slice();
        next[idx] = {
          ...next[idx],
          runId: route.runId || next[idx].runId,
          reasoning: next[idx].reasoning + chunk,
        };
        return { streamingSegments: { ...state.streamingSegments, [sessionId]: next } };
      }
      const created: StreamingSegment = {
        id: nextSegmentId(),
        agent,
        runId: route.runId ?? '',
        agentInstanceId: route.agentInstanceId ?? '',
        content: '',
        reasoning: chunk,
        timeline: [],
        status: 'running',
      };
      return {
        streamingSegments: { ...state.streamingSegments, [sessionId]: [...base, created] },
      };
    });
  },

  // tool_call 作为 timeline 节点记入活动段；tool_result 优先按 tool_call_id 合并回
  // 该线程最近一段里的调用卡。若父 agent 段因子 agent 插入而暂时挂起，
  // 结果仍会更新前缀段中的调用卡，不会在子 agent 后再渲染一张独立结果卡。
  pushSegmentToolCall: (sessionId, agent, route, content, options = {}) => {
    if (!content) return;
    set((state) => {
      const prev = state.streamingSegments[sessionId] ?? [];
      const routed = route.agentInstanceId
        ? detachActiveTopLevelSegments(prev, route.runId ?? '')
        : prev;
      const idx = findSegmentIndex(routed, agent, route, true);
      if (options.kind === 'result') {
        // 活动段优先；没有活动段时回看同身份最近一段。后者覆盖「子 agent 已把父段
        // 暂时挂起，父 invoke tool_result 晚于子 agent 到达」的顺序。
        const targetIdx = idx >= 0 ? idx : findSegmentIndex(routed, agent, route, false);
        if (targetIdx >= 0) {
          const target = routed[targetIdx];
          const attached = attachTimelineToolResult(
            target.timeline,
            content,
            options.toolCallId,
          );
          if (attached.matched) {
            const next = routed.slice();
            next[targetIdx] = { ...target, timeline: attached.timeline };
            return { streamingSegments: { ...state.streamingSegments, [sessionId]: next } };
          }
        }
      }

      const base = idx >= 0 ? routed : detachActiveTopLevelSegments(routed, route.runId ?? '');
      if (idx >= 0) {
        const next = routed.slice();
        const seg = next[idx];
        next[idx] = {
          ...seg,
          runId: route.runId || seg.runId,
          timeline: appendTimelineTool(seg.timeline, content, options),
          status: 'tool_call',
        };
        return { streamingSegments: { ...state.streamingSegments, [sessionId]: next } };
      }
      const created: StreamingSegment = {
        id: nextSegmentId(),
        agent,
        runId: route.runId ?? '',
        agentInstanceId: route.agentInstanceId ?? '',
        content: '',
        reasoning: '',
        timeline: [{ type: 'tool', content, toolCallId: options.toolCallId }],
        status: 'tool_call',
      };
      return {
        streamingSegments: { ...state.streamingSegments, [sessionId]: [...base, created] },
      };
    });
  },

  // plan_updated：canonical JSON 原样进入 timeline，与正文/工具按事件顺序渲染。
  pushSegmentPlan: (sessionId, agent, route, content) => {
    if (!content) return;
    set((state) => {
      const prev = state.streamingSegments[sessionId] ?? [];
      const routed = route.agentInstanceId
        ? detachActiveTopLevelSegments(prev, route.runId ?? '')
        : prev;
      const idx = findSegmentIndex(routed, agent, route, true);
      const base = idx >= 0 ? routed : detachActiveTopLevelSegments(routed, route.runId ?? '');
      if (idx >= 0) {
        const next = routed.slice();
        const seg = next[idx];
        next[idx] = {
          ...seg,
          runId: route.runId || seg.runId,
          timeline: appendTimelinePlan(seg.timeline, content),
        };
        return { streamingSegments: { ...state.streamingSegments, [sessionId]: next } };
      }
      const created: StreamingSegment = {
        id: nextSegmentId(),
        agent,
        runId: route.runId ?? '',
        agentInstanceId: route.agentInstanceId ?? '',
        content: '',
        reasoning: '',
        timeline: [{ type: 'plan', content }],
        status: 'running',
      };
      return {
        streamingSegments: { ...state.streamingSegments, [sessionId]: [...base, created] },
      };
    });
  },

  // 状态置位：agent_end→idle、agent_error→error/isError、tool_call→tool_call。
  // 定位该线程的最后一段（不限活动态），找不到则忽略（无对应段的状态事件
  // 属异常边界）。
  setSegmentStatus: (sessionId, agent, route, status) =>
    set((state) => {
      const prev = state.streamingSegments[sessionId] ?? [];
      const idx = findSegmentIndex(prev, agent, route, false);
      if (idx < 0) return {};
      const next = prev.slice();
      const seg = next[idx];
      next[idx] = {
        ...seg,
        runId: route.runId || seg.runId,
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
