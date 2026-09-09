import { memo, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, CircleDot, ListChecks } from 'lucide-react';
import { useUIStore, type StreamingSegment } from '@/stores/ui-store';
import type { Message, PlanSnapshot } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useMessages } from '@/hooks/use-messages';
import { parseSnapshot, PlanStepList } from './plan-snapshot-card';

// 流式段 timeline 中的最新计划：取所有段里 revision 最大的 plan 项。
function latestStreamPlan(segments: StreamingSegment[]): PlanSnapshot | null {
  let best: PlanSnapshot | null = null;
  for (const seg of segments) {
    for (const item of seg.timeline) {
      if (item.type !== 'plan') continue;
      const snapshot = parseSnapshot(item.content);
      if (snapshot && (!best || snapshot.revision > best.revision)) {
        best = snapshot;
      }
    }
  }
  return best;
}

// 历史通道：按 message-list 同样的 trace_id 规则排除活跃 turn 的半截落库行，
// 取最后一条 plan_updated。reconcile 清空流式段后由它接管，状态栏不闪空。
function latestHistoryPlan(messages: Message[], activeTurnRunId: string | null): PlanSnapshot | null {
  const rows = activeTurnRunId
    ? messages.filter((msg) => msg.role === 'user' || msg.trace_id !== activeTurnRunId)
    : messages;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].event_type === 'plan_updated') {
      return parseSnapshot(rows[i].content);
    }
  }
  return null;
}

const EMPTY_SEGMENTS: StreamingSegment[] = [];

// 外置固定的任务状态栏：从聊天滚动区移出，钉在消息区与输入框之间。
// 单行摘要（当前步骤 + 进度计数），点击展开完整步骤列表。无计划时不渲染。
export const PlanStatusBar = memo(function PlanStatusBar() {
  const activeSessionId = useUIStore((s) => s.activeSessionId);
  const activeTurnRunId = useUIStore((s) =>
    activeSessionId ? (s.turnRuns[activeSessionId] ?? null) : null
  );
  // 选择器只返回 store 里的既有数组引用（或共享空数组），不新建对象——
  // 否则每次渲染都产生新引用，触发无限重渲染。
  const streamingSegments = useUIStore((s) =>
    activeSessionId ? (s.streamingSegments[activeSessionId] ?? EMPTY_SEGMENTS) : EMPTY_SEGMENTS
  );
  const { data } = useMessages(activeSessionId);
  const [expanded, setExpanded] = useState(false);

  const snapshot = useMemo(() => {
    const fromStream = latestStreamPlan(streamingSegments);
    const fromHistory = latestHistoryPlan(data?.messages ?? [], activeTurnRunId);
    if (fromStream && fromHistory) {
      return fromStream.revision >= fromHistory.revision ? fromStream : fromHistory;
    }
    return fromStream ?? fromHistory;
  }, [streamingSegments, data, activeTurnRunId]);

  if (!snapshot) return null;

  const total = snapshot.steps.length;
  const done = snapshot.steps.filter((s) => s.status === 'completed').length;
  const current =
    snapshot.steps.find((s) => s.status === 'in_progress') ??
    snapshot.steps.find((s) => s.status === 'pending');
  const allDone = done === total && total > 0;

  return (
    <div className="relative shrink-0 border-t border-white/50 bg-white/20 backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex h-9 w-full cursor-pointer items-center gap-2 px-4 text-left text-xs transition-colors hover:bg-black/[0.03]"
      >
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-primary" />
        {allDone ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
        ) : (
          <CircleDot className="h-3.5 w-3.5 shrink-0 text-primary" />
        )}
        <span className="min-w-0 flex-1 truncate text-foreground">
          {allDone ? '计划已全部完成' : (current?.step ?? '执行计划')}
        </span>
        <span className="shrink-0 text-muted-foreground">
          {done}/{total}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-180'
          )}
        />
      </button>
      {expanded && (
        <div className="absolute inset-x-0 bottom-full z-40 mb-1 px-3">
          {/* 实底白卡片：玻璃半透明会叠在滚动的消息文字上导致看不清。 */}
          <div className="rounded-xl border border-border bg-white px-3 py-2.5 shadow-lg">
            <header className="flex items-center gap-2 text-xs font-medium text-foreground">
              <ListChecks className="h-3.5 w-3.5 text-primary" />
              <span>执行计划</span>
              <span className="text-muted-foreground">#{snapshot.revision}</span>
            </header>
            <PlanStepList snapshot={snapshot} />
          </div>
        </div>
      )}
    </div>
  );
});
