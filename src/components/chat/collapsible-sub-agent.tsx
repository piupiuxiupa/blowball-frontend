import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, Wrench, AlertCircle, Check, ChevronDown, Lightbulb } from 'lucide-react';
import { useUIStore, type AgentStatus } from '@/stores/ui-store';
import { MarkdownRenderer } from './markdown-renderer';
import { OrderedMessageContent } from './ordered-message-content';
import { SubAgentRunTranscripts } from './sub-agent-run-transcripts';
import { useGlobalDetails } from './use-global-details';
import type { MessageTimelineItem } from '@/lib/message-timeline';

interface CollapsibleSubAgentProps {
  agent: string;
  reasoning: string;
  timeline: MessageTimelineItem[];
  agentInstanceId?: string;
  sessionId?: string | null;
  status: AgentStatus;
  isLive: boolean;
  // 是否允许懒加载该实例的 run 历史（placeholder 模式下气泡展开时的内容来源）。
  // 流式段为 false；持久化块为 true。
  runHistory: boolean;
  // 持久化块 id（agent-<行 id>）：提供时折叠态提升进 ui-store，虚拟列表滚出
  // 视口卸载后滚回仍保持展开；流式段不提供（段 id 的生命周期只有一轮流式）。
  blockId?: string;
}

// 状态指示：running→spinner「回答中」；tool_call→工具图标「调用工具」；
// idle→完成图标「已完成」；error→错误图标「出错」。
function StatusIndicator({ status }: { status: AgentStatus }): ReactNode {
  switch (status) {
    case 'running':
      return (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">回答中</span>
        </>
      );
    case 'tool_call':
      return (
        <>
          <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">调用工具</span>
        </>
      );
    case 'error':
      return (
        <>
          <AlertCircle className="h-3.5 w-3.5 text-destructive" />
          <span className="text-xs text-destructive">出错</span>
        </>
      );
    case 'idle':
      return (
        <>
          <Check className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">已完成</span>
        </>
      );
    default:
      return null;
  }
}

// 子 agent（Chongzhi / Liang）输出：glass 气泡 + 「名字 + 状态指示」头部，正文可折叠。
// 默认折叠——同时适用于持久化块与流式段，**包括正在输出的活动段**（design D5）。
// 折叠时不渲染正文（内容仍在 state 持续累积）；展开后显示 reasoning 与该调用自己的
// timeline，正文片段和工具记录在气泡内按到达顺序渲染，
// 且展开后尾部继续流式追加。折叠活动段还顺带跳过 Markdown 增量渲染，省去重解析成本。
export const CollapsibleSubAgent = memo(function CollapsibleSubAgent({
  agent,
  reasoning,
  timeline,
  agentInstanceId,
  sessionId,
  status,
  isLive,
  runHistory,
  blockId,
}: CollapsibleSubAgentProps) {
  // 折叠态分两路：持久化块（blockId 存在）提升进 ui-store——虚拟列表滚出视口
  // 会卸载组件，本地态会让「展开看明细 → 往下翻 → 回看」时气泡自动合上；
  // 流式段用组件本地态即可（段随 reconcile 整体替换，本地折叠态无存续价值）。
  const persistedExpanded = useUIStore((s) =>
    blockId && sessionId ? (s.expandedSubAgentBlocks[sessionId]?.[blockId] ?? false) : false
  );
  const setPersistedExpanded = useUIStore((s) => s.setSubAgentBlockExpanded);
  const [localExpanded, setLocalExpanded] = useState(false);
  const expandAll = useUIStore((s) => s.contentExpandAll);
  const collapseVersion = useUIStore((s) => s.contentCollapseVersion);
  // 全局「展开全部/收起全部」覆盖：collapseVersion 变化（每次点击全局按钮）时
  // 清洗本地态，让块重新跟随 expandAll。持久化块的 ui-store 记录已在
  // toggleContentExpandAll 侧清空，这里只重置流式段的本地态。
  useEffect(() => {
    if (expandAll !== null) setLocalExpanded(expandAll);
  }, [expandAll, collapseVersion]);
  const globalOverride = expandAll !== null;
  const collapsed = globalOverride
    ? !expandAll
    : blockId
      ? !persistedExpanded
      : !localExpanded;
  const toggleCollapsed = () => {
    // 全局覆盖生效期间，单块点击只翻转本地态，不写持久化记录（下次全局切换
    // 会清洗），避免持久化记录与全局态互相打架。
    if (globalOverride || !blockId || !sessionId) {
      setLocalExpanded((current) => !current);
      return;
    }
    setPersistedExpanded(sessionId, blockId, !persistedExpanded);
  };
  const reasoningRef = useRef<HTMLDetailsElement>(null);
  useGlobalDetails(reasoningRef);

  return (
    // 弱化子 agent 显示（chat-visual-hierarchy）：去 glass 气泡，降级为细行注脚。
    // 默认折叠仍保留（design D5），展开内容用细竖线缩进，与主回答形成层级差。
    <div className="text-sm">
      <button
        type="button"
        onClick={toggleCollapsed}
        className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-black/[0.03]"
        aria-expanded={!collapsed}
      >
        <span className="font-medium text-muted-foreground">{agent}</span>
        <span className="flex items-center gap-1">
          <StatusIndicator status={status} />
        </span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform ${
            collapsed ? '' : 'rotate-180'
          }`}
        />
      </button>

      {!collapsed && (
        <div className="space-y-2 border-l-2 border-foreground/10 py-1 pl-3 ml-1.5 mt-0.5">
          {reasoning && (
            // 与 BareConfucius 一致的弱化样式：细竖线 + 灰字一行，默认折叠。
            // 接入全局「展开全部/收起全部」（useGlobalDetails）。
            <details ref={reasoningRef} className="border-l-2 border-foreground/10 pl-2.5">
              <summary className="flex cursor-pointer list-none items-center gap-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                <Lightbulb className="h-3 w-3" />
                <span>思考过程</span>
              </summary>
              <div className="prose prose-sm max-w-none max-h-64 overflow-auto pt-1 text-xs text-muted-foreground">
                <MarkdownRenderer>{reasoning}</MarkdownRenderer>
              </div>
            </details>
          )}

          <OrderedMessageContent timeline={timeline} isLive={isLive} />

          {/* 持久化子 Agent 块的内容来源（placeholder 模式）：点击展开才挂载，
              内部经 runs 接口取该实例的终态执行明细。流式段不挂——段本身就是
              run 的实时输出，且进行中的 run 尚无终态行可查。 */}
          {runHistory && sessionId && agentInstanceId && (
            <SubAgentRunTranscripts sessionId={sessionId} agentInstanceId={agentInstanceId} />
          )}

          {timeline.length === 0 && !reasoning && status === 'running' && (
            <div className="text-xs text-muted-foreground">思考中…</div>
          )}
        </div>
      )}
    </div>
  );
});
