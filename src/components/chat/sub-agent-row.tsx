import { memo, useContext, type ReactNode } from 'react';
import { Loader2, Wrench, AlertCircle, Check, PanelTopOpen } from 'lucide-react';
import { useUIStore, type AgentStatus } from '@/stores/ui-store';
import { ArtifactLinkContext } from './markdown-renderer';

interface SubAgentRowProps {
  agent: string;
  status: AgentStatus;
  sessionId?: string | null;
  // 线程身份：用于 reconcile 后浮窗向同身份持久化块回退。
  runId?: string;
  agentInstanceId?: string;
  // 持久化块 id / 流式段 id，二选一；决定浮窗 target。
  blockId?: string;
  segmentId?: string;
}

// 状态指示：running→spinner「回答中」；tool_call→工具图标「调用工具」；
// idle→完成图标「已完成」；error→错误图标「出错」。触发行与浮窗头部共用。
export function StatusIndicator({ status }: { status: AgentStatus }): ReactNode {
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

// 子 agent（Chongzhi / Liang）触发行（subagent-float-window）：聊天流内只保留
// 「名字 + 状态」注脚，点击打开浮窗查看完整内容，不再行内展开。钉版上下文取自
// 外层 ArtifactLinkContext（ChatMessage 按块注入；流式段无 Provider 即无快照）。
export const SubAgentRow = memo(function SubAgentRow({
  agent,
  status,
  sessionId,
  runId,
  agentInstanceId,
  blockId,
  segmentId,
}: SubAgentRowProps) {
  const openSubAgent = useUIStore((s) => s.openSubAgent);
  const linkCtx = useContext(ArtifactLinkContext);

  const handleClick = () => {
    if (!sessionId) return;
    const target = blockId
      ? ({ kind: 'block', id: blockId } as const)
      : segmentId
        ? ({ kind: 'segment', id: segmentId } as const)
        : null;
    if (!target) return;
    openSubAgent({
      sessionId,
      agent,
      runId: runId ?? '',
      agentInstanceId: agentInstanceId ?? '',
      target,
      turnArtifacts: linkCtx?.artifacts,
      msgTime: linkCtx?.msgTime,
    });
  };

  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={handleClick}
        className="group flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-black/[0.03]"
        title="打开子 Agent 详情"
      >
        <span className="font-medium text-muted-foreground">{agent}</span>
        <span className="flex items-center gap-1">
          <StatusIndicator status={status} />
        </span>
        <PanelTopOpen
          className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground"
          aria-hidden
        />
      </button>
    </div>
  );
});
