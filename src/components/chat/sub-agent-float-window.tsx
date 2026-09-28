import { useEffect, useMemo } from 'react';
import { Lightbulb, Loader2, X } from 'lucide-react';
import { useUIStore, type AgentStatus, type StreamingSegment } from '@/stores/ui-store';
import { useMessages } from '@/hooks/use-messages';
import type { MessageTimelineItem } from '@/lib/message-timeline';
import { groupMessages, type MessageBlock } from './message-list';
import { ArtifactLinkContext } from './markdown-renderer';
import { MarkdownRenderer } from './markdown-renderer';
import { OrderedMessageContent } from './ordered-message-content';
import { SubAgentRunTranscripts } from './sub-agent-run-transcripts';
import { StatusIndicator } from './sub-agent-row';

const EMPTY_SEGMENTS: StreamingSegment[] = [];

// 归一化视图：流式段与持久化块统一为浮窗正文的渲染形状（design D2/D4）。
interface WindowView {
  agent: string;
  status: AgentStatus;
  reasoning: string;
  timeline: MessageTimelineItem[];
  isLive: boolean;
  // 仅持久化块：挂载 runs 懒加载（placeholder 历史的正文明细来源）。
  runHistory: boolean;
  agentInstanceId: string;
  turnArtifacts?: MessageBlock['turnArtifacts'];
  msgTime?: string;
}

// 子 Agent 浮窗（subagent-float-window）：单实例、非模态、固定定位，渲染在
// ChatPanel 层（虚拟列表外，滚动聊天不卸载）。内容按身份从活源解析——流式段
// 订阅 ui-store 实时追加；reconcile 清段后按 (agent, agentInstanceId) 回退到
// 持久化块（reconcile 先确认完整落库再清段，回退时块必然已在 messages 缓存）。
export function SubAgentFloatWindow() {
  const activeSessionId = useUIStore((s) => s.activeSessionId);
  const win = useUIStore((s) => s.openSubAgentWindow);
  const close = useUIStore((s) => s.closeSubAgentWindow);
  const visible = !!win && win.sessionId === activeSessionId;
  const segments = useUIStore((s) =>
    win ? (s.streamingSegments[win.sessionId] ?? EMPTY_SEGMENTS) : EMPTY_SEGMENTS
  );
  // 挂在 ChatPanel 且仅在可见时取数；与 MessageList 共用 ['messages', sessionId]
  // 缓存，不产生额外请求。
  const { data, isFetching } = useMessages(visible && win ? win.sessionId : null);
  const blocks = useMemo(() => groupMessages(data?.messages ?? []), [data]);

  const view = useMemo<WindowView | null>(() => {
    if (!win) return null;
    if (win.target.kind === 'block') {
      const block = blocks.find((b) => b.id === win.target.id);
      if (!block) return null;
      return {
        agent: block.agent,
        status: block.isError ? 'error' : 'idle',
        reasoning: block.reasoning ?? '',
        timeline: block.timeline,
        isLive: false,
        runHistory: true,
        agentInstanceId: block.agentInstanceId,
        turnArtifacts: block.turnArtifacts,
        msgTime: block.msgTime,
      };
    }
    const segment = segments.find((s) => s.id === win.target.id);
    if (segment) {
      return {
        agent: segment.agent,
        status: segment.status,
        reasoning: segment.reasoning,
        timeline: segment.timeline,
        isLive: segment.status === 'running' || segment.status === 'tool_call',
        runHistory: false,
        agentInstanceId: segment.agentInstanceId,
      };
    }
    // 段已被 reconcile 清空：回退到同身份持久化块（动态实例按 agentInstanceId，
    // 存量行按 (agent, runId)）。
    const block = blocks.find(
      (b) =>
        b.role === 'assistant' &&
        b.agent === win.agent &&
        (win.agentInstanceId
          ? b.agentInstanceId === win.agentInstanceId
          : b.runId === win.runId)
    );
    if (!block) return null;
    return {
      agent: block.agent,
      status: block.isError ? 'error' : 'idle',
      reasoning: block.reasoning ?? '',
      timeline: block.timeline,
      isLive: false,
      runHistory: true,
      agentInstanceId: block.agentInstanceId,
      turnArtifacts: block.turnArtifacts,
      msgTime: block.msgTime,
    };
  }, [win, blocks, segments]);

  // 目标既不在流式段也不在历史块（数据已失效/被删）：关窗，不留悬空窗口。
  // isFetching 期间等待——reconcile 重拉历史时块稍后才到。
  useEffect(() => {
    if (!visible || view || isFetching) return;
    close();
  }, [visible, view, isFetching, close]);

  // Esc 关窗（焦点在文本输入控件内时不抢，design 风险项）。
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, close]);

  if (!visible || !win) return null;

  return (
    <aside
      role="dialog"
      aria-label={`${win.agent} 详情`}
      className="fixed right-4 top-20 bottom-24 z-40 flex w-[460px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-white/60 bg-background/95 shadow-xl backdrop-blur"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-white/40 px-3">
        <span className="text-xs font-medium text-foreground">{win.agent}</span>
        <span className="flex items-center gap-1">
          <StatusIndicator status={view?.status ?? 'idle'} />
        </span>
        <button
          type="button"
          onClick={close}
          className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground"
          aria-label="关闭子 Agent 详情"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-sm">
        {!view ? (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在定位子 Agent…
          </div>
        ) : (
          <ArtifactLinkContext.Provider
            value={{ artifacts: view.turnArtifacts, msgTime: view.msgTime }}
          >
            <div className="space-y-2 py-1">
              {view.reasoning && (
                <details className="border-l-2 border-foreground/10 pl-2.5">
                  <summary className="flex cursor-pointer list-none items-center gap-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                    <Lightbulb className="h-3 w-3" />
                    <span>思考过程</span>
                  </summary>
                  <div className="prose prose-sm max-w-none max-h-64 overflow-auto pt-1 text-xs text-muted-foreground">
                    <MarkdownRenderer>{view.reasoning}</MarkdownRenderer>
                  </div>
                </details>
              )}

              <OrderedMessageContent timeline={view.timeline} isLive={view.isLive} />

              {/* 持久化块才挂 runs 懒加载（placeholder 模式的内容来源）；流式段
                  本身就是本次执行的实时输出。 */}
              {view.runHistory && win.sessionId && view.agentInstanceId && (
                <SubAgentRunTranscripts
                  sessionId={win.sessionId}
                  agentInstanceId={view.agentInstanceId}
                />
              )}

              {view.timeline.length === 0 && !view.reasoning && view.status === 'running' && (
                <div className="text-xs text-muted-foreground">思考中…</div>
              )}
            </div>
          </ArtifactLinkContext.Provider>
        )}
      </div>
    </aside>
  );
}
