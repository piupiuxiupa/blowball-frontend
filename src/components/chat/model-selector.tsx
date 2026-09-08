import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModels } from '@/hooks/use-models';
import { useUIStore } from '@/stores/ui-store';
import type { ReasoningEffort } from '@/lib/api';

// 下一次发送的模型与思考等级选择（per-request-model）。选中即写入 ui-store,
// MessageInput 发送时作为可选参数带上;「默认」= 不发参数,由后端按配置/目录条目
// 派生。挂在输入区上方（影响的是下一条消息,而非整个面板）。

// UI 提供的思考等级（契约枚举全集,含 max）。
const EFFORT_OPTIONS: ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];

export function ModelSelector() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data } = useModels();
  const selectedModel = useUIStore((s) => s.selectedModel);
  const selectedEffort = useUIStore((s) => s.selectedEffort);
  const setModelSelection = useUIStore((s) => s.setModelSelection);

  const models = data?.models ?? [];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // 生效模型条目 = 显式选中项,否则后端缺省。思考等级门控依赖它:
  // 非 thinking 模型上非 none 的等级会被后端 400 INVALID_EFFORT,这里直接禁用。
  const effective =
    models.find((m) => m.name === selectedModel) ??
    models.find((m) => m.name === data?.default) ??
    null;
  const effortAllowed = effective?.thinking ?? false;

  // 无目录(后端合成单条 legacy 条目)或单条目部署:没有可选空间,且显式传参会
  // 400 INVALID_MODEL——整个选择器不渲染。
  if (models.length <= 1) return null;

  const triggerLabel = selectedModel ?? '默认模型';
  const effortLabel = selectedEffort ? ` · 思考 ${selectedEffort}` : '';

  const pickModel = (name: string | null) => setModelSelection(name, selectedEffort);
  const pickEffort = (effort: ReasoningEffort | null) => setModelSelection(selectedModel, effort);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'glass-subtle flex h-7 items-center gap-1.5 rounded-full px-3 text-xs text-foreground/80',
          'transition-all hover:bg-white/75 active:scale-[0.97]',
          open && 'bg-white/85 text-foreground',
        )}
      >
        <span className="max-w-[220px] truncate">
          {triggerLabel}
          {effortLabel}
        </span>
        <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        // 输入区在面板底部,下拉向上展开（对齐 catalogue-button 的交互:外点关闭、Esc 关闭）。
        <div className="glass-strong absolute bottom-full left-0 z-50 mb-1.5 w-[320px] overflow-hidden rounded-2xl">
          <div className="border-b border-white/50 px-3 py-2 text-xs font-semibold text-foreground">
            模型
          </div>
          <div className="max-h-[220px] overflow-y-auto p-1.5">
            <SelectRow
              label="默认"
              hint="按后端配置"
              checked={!selectedModel}
              onClick={() => pickModel(null)}
            />
            {models.map((m) => (
              <SelectRow
                key={m.name}
                label={m.name}
                hint={`${Math.round(m.max_context_tokens / 1000)}k 上下文${m.thinking ? ' · 支持思考' : ''}`}
                checked={selectedModel === m.name}
                onClick={() => pickModel(m.name)}
              />
            ))}
          </div>

          <div className="border-t border-white/50 px-3 py-2 text-xs font-semibold text-foreground">
            思考等级
          </div>
          <div className="flex flex-wrap gap-1 p-1.5">
            <EffortChip label="默认" active={!selectedEffort} onClick={() => pickEffort(null)} />
            {EFFORT_OPTIONS.map((e) => (
              <EffortChip
                key={e}
                label={e}
                active={selectedEffort === e}
                // 非 thinking 模型仅 none 可用;「默认」档派生规则同样不会给出思考。
                disabled={!effortAllowed && e !== 'none'}
                onClick={() => pickEffort(e)}
              />
            ))}
          </div>
          {!effortAllowed && (
            <div className="px-3 pb-2 text-[10px] leading-snug text-muted-foreground">
              当前模型不支持思考,思考等级仅可选 none
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SelectRow({
  label,
  hint,
  checked,
  onClick,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.06]"
    >
      <Check
        className={cn('h-3.5 w-3.5 shrink-0 text-primary', !checked && 'opacity-0')}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs font-medium text-foreground">{label}</div>
        {hint && <div className="truncate text-[10px] leading-snug text-muted-foreground">{hint}</div>}
      </div>
    </button>
  );
}

function EffortChip({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-full px-2.5 py-1 font-mono text-[11px] transition-all',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-foreground/[0.06] text-foreground/80 hover:bg-foreground/[0.1]',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      {label}
    </button>
  );
}
