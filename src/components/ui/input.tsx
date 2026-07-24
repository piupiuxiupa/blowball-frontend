import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-2xl border border-white/60 bg-white/55 px-3.5 py-1 text-sm ' +
          'backdrop-blur-xl transition-all placeholder:text-muted-foreground ' +
          'file:border-0 file:bg-transparent file:text-sm file:font-medium ' +
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
Input.displayName = 'Input';

export { Input };
