import { useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface ResizerProps {
  direction?: 'horizontal' | 'vertical';
  min?: number;
  max?: number;
  onResize: (delta: number) => void;
  className?: string;
}

export function Resizer({ direction = 'horizontal', onResize, className }: ResizerProps) {
  const startRef = useRef(0);
  const isDraggingRef = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      startRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
      (e.target as Element).setPointerCapture(e.pointerId);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    },
    [direction]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current) return;
      const current = direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = current - startRef.current;
      if (delta !== 0) {
        onResize(delta);
        startRef.current = current;
      }
    },
    [direction, onResize]
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    (e.target as Element).releasePointerCapture(e.pointerId);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, []);

  return (
    <div
      role="separator"
      aria-orientation={direction}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={cn(
        'group/resizer relative shrink-0 cursor-col-resize',
        direction === 'horizontal' ? 'w-3 cursor-col-resize' : 'h-3 cursor-row-resize',
        className
      )}
    >
      {/* Hairline reveal on hover/active; transparent otherwise so the mesh shows through. */}
      <span
        className={cn(
          'absolute rounded-full bg-foreground/0 transition-colors duration-200 ' +
            'group-hover/resizer:bg-primary/60 group-active/resizer:bg-primary',
          direction === 'horizontal'
            ? 'left-1/2 top-1/2 h-10 w-px -translate-x-1/2 -translate-y-1/2'
            : 'left-1/2 top-1/2 h-px w-10 -translate-x-1/2 -translate-y-1/2'
        )}
      />
    </div>
  );
}
