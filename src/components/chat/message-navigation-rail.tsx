import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { cn } from '@/lib/utils';

export interface UserMessageAnchor {
  id: string;
  /** 用户消息在虚拟列表中的行号，供消息区执行真实滚动。 */
  itemIndex: number;
  /** 用户消息在“仅用户消息”序列中的序号，供轨道当前态与预览编号使用。 */
  turnIndex: number;
  preview: string;
  msgTime?: string;
}

interface MessageNavigationRailProps {
  anchors: UserMessageAnchor[];
  activeIndex: number;
  highlightedId: string | null;
  onSelect: (anchor: UserMessageAnchor) => void;
}

// Codex 风格的左侧等距刻度轨道。刻度本身不代表真实滚动高度，而是把每个用户回合
// 均匀映射到固定间距上，长会话也能在窄边栏里一眼定位；悬停时按距离形成涟漪宽度。
const TICK_WIDTHS = [26, 20, 14, 10, 6] as const;

function formatTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function MessageNavigationRail({
  anchors,
  activeIndex,
  highlightedId,
  onSelect,
}: MessageNavigationRailProps) {
  const railScrollRef = useRef<HTMLDivElement>(null);
  const previewNodeRef = useRef<HTMLButtonElement | null>(null);
  const railPinnedToLatestRef = useRef(true);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [previewCenter, setPreviewCenter] = useState<number | null>(null);
  const [railHeight, setRailHeight] = useState(0);
  const railVisible = anchors.length >= 2;

  const syncPreviewPosition = useCallback((node: HTMLButtonElement) => {
    const rail = railScrollRef.current;
    if (!rail) return;
    previewNodeRef.current = node;
    setPreviewCenter(node.offsetTop - rail.scrollTop + node.offsetHeight / 2);
  }, []);

  useEffect(() => {
    if (!railVisible) return;
    const rail = railScrollRef.current;
    if (!rail) return;

    const syncHeight = () => setRailHeight(rail.clientHeight);
    syncHeight();

    const observer = new ResizeObserver(syncHeight);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [railVisible]);

  // 轨道默认跟随最新回合；用户上滚浏览早期刻度时不强行拉回，新消息到来且仍贴底才跟随。
  useEffect(() => {
    const rail = railScrollRef.current;
    if (rail && railPinnedToLatestRef.current) {
      rail.scrollTop = rail.scrollHeight;
    }
  }, [anchors.length, railVisible]);

  const handleTickHover = (index: number) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    setHoverIndex(index);
    syncPreviewPosition(event.currentTarget);
  };

  const handleTickFocus = (index: number) => (event: ReactFocusEvent<HTMLButtonElement>) => {
    setHoverIndex(index);
    syncPreviewPosition(event.currentTarget);
  };

  const clearHover = () => {
    previewNodeRef.current = null;
    setHoverIndex(null);
    setPreviewCenter(null);
  };

  const handleRailScroll = () => {
    const rail = railScrollRef.current;
    if (!rail) return;
    railPinnedToLatestRef.current =
      rail.scrollTop + rail.clientHeight >= rail.scrollHeight - 2;

    // 刻度条滚动时按钮的视口位置变化，预览卡需要跟随其所属按钮重新取位。
    const node = previewNodeRef.current;
    if (node) setPreviewCenter(node.offsetTop - rail.scrollTop + node.offsetHeight / 2);
  };

  // 少于两个用户回合时轨道没有导航价值，保持消息区满宽，避免常驻噪音。
  if (!railVisible) return null;

  const preview = hoverIndex == null ? undefined : anchors[hoverIndex];
  const previewTop =
    previewCenter == null
      ? 0
      : Math.min(Math.max(previewCenter, 42), Math.max(42, railHeight - 42));

  return (
    <div
      role="navigation"
      aria-label="用户消息导航"
      className="pointer-events-none absolute inset-y-3 left-0 z-20 flex w-[42px] justify-center"
    >
      <div
        ref={railScrollRef}
        className="message-rail-scroll pointer-events-auto h-full max-h-[500px] overflow-y-auto"
        onScroll={handleRailScroll}
        onMouseLeave={clearHover}
      >
        <div className="flex min-h-full flex-col items-center justify-end">
          {anchors.map((anchor) => {
            const distance =
              hoverIndex == null
                ? TICK_WIDTHS.length - 1
                : Math.min(Math.abs(anchor.turnIndex - hoverIndex), TICK_WIDTHS.length - 1);
            const isActive = anchor.turnIndex === activeIndex;
            const isHighlighted = anchor.id === highlightedId;

            return (
              <button
                key={anchor.id}
                type="button"
                className="flex h-[10px] w-[42px] items-center justify-center"
                aria-current={isActive ? 'true' : undefined}
                aria-label={`跳转到第 ${anchor.turnIndex + 1} 条用户消息：${anchor.preview.slice(0, 80)}`}
                title={`第 ${anchor.turnIndex + 1} 条用户消息`}
                onPointerEnter={handleTickHover(anchor.turnIndex)}
                onFocus={handleTickFocus(anchor.turnIndex)}
                onBlur={clearHover}
                onClick={() => onSelect(anchor)}
              >
                <span
                  style={{ width: TICK_WIDTHS[distance] }}
                  className={cn(
                    'h-[2px] rounded-full bg-foreground/25 transition-all duration-150',
                    isActive && 'bg-foreground/60',
                    hoverIndex === anchor.turnIndex && 'bg-foreground/80',
                    isHighlighted && 'bg-primary shadow-[0_0_0_3px_rgba(255,159,10,0.18)]'
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>

      {preview && previewCenter != null && (
        <div
          className="glass-strong pointer-events-none absolute left-[34px] w-64 rounded-2xl px-3 py-2 text-left shadow-lg"
          style={{ top: previewTop, transform: 'translateY(-50%)' }}
        >
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">#{preview.turnIndex + 1}</span>
            {preview.msgTime && <span>{formatTime(preview.msgTime)}</span>}
          </div>
          <div className="mt-1 line-clamp-3 text-xs leading-snug text-foreground">
            {preview.preview}
          </div>
        </div>
      )}
    </div>
  );
}
