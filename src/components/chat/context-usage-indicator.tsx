import { useContextUsage } from '@/hooks/use-context-usage';
import { DRAFT_SESSION_ID, useUIStore } from '@/stores/ui-store';

const tokenFormatter = new Intl.NumberFormat('zh-CN');

// 最近持久化 turn 的上下文观测，而非流式期间的下一次请求估算。
export function ContextUsageIndicator() {
  const sessionId = useUIStore((s) => s.activeSessionId);
  const { data } = useContextUsage(sessionId);

  // 初次加载、空会话与草稿不显示；明确 unavailable 时保留可见状态，避免用户
  // 无法区分“尚未加载”与“最新持久化 turn 没有完整快照”。
  if (!sessionId || sessionId === DRAFT_SESSION_ID || !data) return null;
  if (!data.available) {
    return (
      <div
        className="flex shrink-0 items-center text-[11px] text-muted-foreground"
        title="当前会话最新持久化轮次暂无完整上下文快照；新完成一轮后会自动更新"
      >
        <span>上下文 暂无快照</span>
      </div>
    );
  }

  const percent = Math.max(
    0,
    Math.min(100, Math.round((data.context_tokens / data.input_budget_tokens) * 100))
  );
  const used = tokenFormatter.format(data.context_tokens);
  const budget = tokenFormatter.format(data.input_budget_tokens);
  const remaining = tokenFormatter.format(data.remaining_tokens);
  const details = [
    `最近已持久化轮次 · ${data.model}`,
    `上下文 ${used} / 输入预算 ${budget} tokens`,
    `剩余 ${remaining} tokens · 硬窗口 ${tokenFormatter.format(data.max_context_tokens)} tokens`,
    `Run ${data.run_id}`,
    `测量时间 ${new Date(data.measured_at).toLocaleString('zh-CN')}`,
  ].join('\n');

  return (
    <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground" title={details}>
      <span>上下文 {percent}%</span>
      <div
        role="meter"
        aria-label="最近已持久化轮次的上下文输入预算使用率"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`已用 ${used}，输入预算 ${budget}，剩余 ${remaining} tokens`}
        className="h-1.5 w-16 overflow-hidden rounded-full bg-foreground/10"
      >
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
