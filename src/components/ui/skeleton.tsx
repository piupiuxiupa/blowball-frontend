import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-xl bg-foreground/[0.06]', className)}
      style={{ boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.4)' }}
      {...props}
    />
  );
}

export { Skeleton };
