import { memo, useState, type ReactNode } from 'react';
import { Loader2, Wrench, AlertCircle, Check, ChevronDown, Lightbulb } from 'lucide-react';
import type { AgentStatus } from '@/stores/ui-store';
import { MarkdownRenderer } from './markdown-renderer';
import { OrderedMessageContent } from './ordered-message-content';
import { SubAgentRunTranscripts } from './sub-agent-run-transcripts';
import type { MessageTimelineItem } from '@/lib/message-timeline';

interface CollapsibleSubAgentProps {
  agent: string;
  reasoning: string;
  timeline: MessageTimelineItem[];
  agentInstanceId?: string;
  sessionId?: string | null;
  status: AgentStatus;
  isLive: boolean;
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
}: CollapsibleSubAgentProps) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="glass space-y-1 rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={!collapsed}
      >
        <span className="text-xs font-medium text-foreground">{agent}</span>
        <span className="flex items-center gap-1">
          <StatusIndicator status={status} />
        </span>
        <ChevronDown
          className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            collapsed ? '' : 'rotate-180'
          }`}
        />
      </button>

      {!collapsed && (
        <div className="space-y-2 pt-1">
          {reasoning && (
            <details className="rounded-xl border border-white/50 bg-white/40 px-2.5 py-1.5 backdrop-blur-md">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground">
                <Lightbulb className="h-3 w-3" />
                <span>思考过程</span>
              </summary>
              <div className="prose prose-sm max-w-none pt-1 text-muted-foreground">
                <MarkdownRenderer>{reasoning}</MarkdownRenderer>
              </div>
            </details>
          )}

          <OrderedMessageContent timeline={timeline} isLive={isLive} />

          {sessionId && agentInstanceId && (
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
