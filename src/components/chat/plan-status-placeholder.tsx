import { memo } from 'react';
import { ListChecks } from 'lucide-react';
import { parseSnapshot } from './plan-snapshot-card';

// 消息流内的 plan_updated 轻量占位：完整计划卡已外置为固定状态栏
// （PlanStatusBar，输入框上方），这里只保留一行事件序痕迹，
// 保持 timeline「按到达顺序呈现每次修订」的语义而不占用视觉重量。
export const PlanStatusPlaceholder = memo(function PlanStatusPlaceholder({ raw }: { raw: string }) {
  const snapshot = parseSnapshot(raw);
  return (
    <div className="flex items-center gap-1.5 px-1.5 py-1 text-xs text-muted-foreground/70">
      <ListChecks className="h-3 w-3 shrink-0" />
      <span>
        执行计划已更新{snapshot ? ` #${snapshot.revision}` : ''} · 见下方状态栏
      </span>
    </div>
  );
});
