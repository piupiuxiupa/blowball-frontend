import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CatalogueButtonProps {
  label: string;
  icon: ReactNode;
  tooltip: string;
  count?: number;
  isLoading?: boolean;
  error?: Error | null;
  children: ReactNode;
}

/**
 * A small icon button for the chat composer's top-right corner that toggles a
 * glassy dropdown listing a catalogue (tools or skills). Handles click-outside
 * and Escape to close; loading/error/empty states are centralized here while the
 * caller supplies the list body as children.
 */
export function CatalogueButton({
  label,
  icon,
  tooltip,
  count,
  isLoading,
  error,
  children,
}: CatalogueButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={tooltip}
        title={tooltip}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'glass-subtle flex h-7 w-7 items-center justify-center rounded-full text-foreground/70',
          'transition-all hover:bg-white/75 hover:text-foreground active:scale-95',
          open && 'bg-white/85 text-foreground'
        )}
      >
        {icon}
      </button>

      {open && (
        <div className="glass-strong absolute right-0 top-full z-50 mt-1.5 w-[320px] overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-white/50 px-3 py-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              {label}
              {typeof count === 'number' && (
                <span className="rounded-full bg-foreground/10 px-1.5 text-[10px] font-medium text-muted-foreground">
                  {count}
                </span>
              )}
            </span>
            <button
              type="button"
              aria-label="关闭"
              onClick={() => setOpen(false)}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="max-h-[320px] overflow-y-auto p-1.5">
            {isLoading ? (
              <div className="space-y-1.5 p-1">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-9 animate-pulse rounded-xl bg-foreground/5" />
                ))}
              </div>
            ) : error ? (
              <div className="px-2 py-6 text-center text-xs text-destructive">
                加载失败：{error.message}
              </div>
            ) : (
              children
            )}
          </div>
        </div>
      )}
    </div>
  );
}
