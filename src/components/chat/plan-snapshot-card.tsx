import { memo } from 'react';
import { CheckCircle2, Circle, CircleDot, ListChecks } from 'lucide-react';
import type { PlanSnapshot } from '@/lib/api';
import { cn } from '@/lib/utils';

export function parseSnapshot(raw: string): PlanSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as PlanSnapshot;
    if (
      typeof parsed.revision !== 'number' ||
      !Array.isArray(parsed.steps) ||
      !parsed.steps.every(
        (step) =>
          typeof step.step === 'string' &&
          typeof step.status === 'string' &&
          ['pending', 'in_progress', 'completed'].includes(step.status)
      )
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function StepIcon({ status }: { status: PlanSnapshot['steps'][number]['status'] }) {
  if (status === 'completed') {
    return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />;
  }
  if (status === 'in_progress') {
    return <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />;
  }
  return <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />;
}

export function statusText(status: PlanSnapshot['steps'][number]['status']) {
  if (status === 'completed') return '已完成';
  if (status === 'in_progress') return '进行中';
  return '待处理';
}

// 步骤列表渲染抽为共享片段：消息流内的完整计划卡与外置 PlanStatusBar 的
// 展开浮层共用同一份步骤 UI，避免两处各维护一份状态图标/文案映射。
export function PlanStepList({ snapshot }: { snapshot: PlanSnapshot }) {
  return (
    <>
      <ol className="mt-2 space-y-1.5">
        {snapshot.steps.map((step, index) => (
          <li key={`${index}-${step.step}`} className="flex min-w-0 items-start gap-2">
            <StepIcon status={step.status} />
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  'text-xs leading-snug',
                  step.status === 'completed' ? 'text-muted-foreground' : 'text-foreground'
                )}
              >
                {step.step}
              </div>
              <div className="text-[10px] text-muted-foreground">{statusText(step.status)}</div>
            </div>
          </li>
        ))}
      </ol>
      {snapshot.explanation && (
        <p className="mt-2 border-t border-white/50 pt-2 text-[11px] leading-snug text-muted-foreground">
          {snapshot.explanation}
        </p>
      )}
    </>
  );
}

// plan_updated 的语义计划卡。保留在事件 timeline 中而不是只显示“最新计划”，
// 让流式与历史都按到达顺序呈现每次修订；多个 in_progress 允许并行任务共存。
export const PlanSnapshotCard = memo(function PlanSnapshotCard({ raw }: { raw: string }) {
  const snapshot = parseSnapshot(raw);
  if (!snapshot) {
    return (
      <div className="rounded-xl border border-white/50 bg-white/40 px-3 py-2 text-xs text-muted-foreground">
        计划数据无法解析
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-white/50 bg-white/40 px-3 py-2.5 backdrop-blur-md">
      <header className="flex items-center gap-2 text-xs font-medium text-foreground">
        <ListChecks className="h-3.5 w-3.5 text-primary" />
        <span>执行计划</span>
        <span className="text-muted-foreground">#{snapshot.revision}</span>
      </header>
      <PlanStepList snapshot={snapshot} />
    </section>
  );
});
