import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[60px] w-full resize-none rounded-2xl border border-white/60 bg-white/55 px-3.5 py-2.5 text-sm ' +
          'backdrop-blur-xl transition-all placeholder:text-muted-foreground ' +
          'hover:bg-white/70 ' +
          'focus-visible:outline-none focus-visible:border-primary/60 focus-visible:bg-white/80 ' +
          'focus-visible:ring-2 focus-visible:ring-ring/40 ' +
          'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };
