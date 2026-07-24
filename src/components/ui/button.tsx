import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // Base: capsule (elliptical) shape, glossy specular top-light, springy press.
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium ' +
    'transition-all duration-200 ease-out select-none ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-0 ' +
    'disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97]',
  {
    variants: {
      variant: {
        // Amber primary — dark text for contrast, warm glow, top specular sheen.
        default:
          'bg-primary text-primary-foreground ' +
          'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.55),0_6px_18px_-6px_rgba(255,159,10,0.6)] ' +
          'hover:brightness-[1.05] hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.6),0_8px_22px_-6px_rgba(255,159,10,0.7)]',
        destructive:
          'bg-destructive text-destructive-foreground ' +
          'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.35),0_6px_18px_-6px_rgba(255,69,58,0.55)] hover:brightness-[1.05]',
        // Frosted glass capsule.
        glass: 'glass text-foreground hover:bg-white/70',
        // Light outlined glass.
        outline: 'border border-border bg-white/45 backdrop-blur-md text-foreground hover:bg-white/70',
        // Tinted secondary capsule.
        secondary: 'glass-subtle text-secondary-foreground hover:bg-white/70',
        // Ghost — transparent, subtle hover wash (for icon buttons).
        ghost: 'text-foreground hover:bg-foreground/[0.06] hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-5',
        sm: 'h-8 px-3.5 text-xs',
        lg: 'h-11 px-7 text-[15px]',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
