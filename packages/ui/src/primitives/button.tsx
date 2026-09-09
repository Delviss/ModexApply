'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a leading icon; the accessible name still comes from the label. */
  icon?: React.ReactNode;
}

/**
 * The one button. `destructive` is `--mx-danger`, not brand crimson — brand red
 * is reserved for the primary action and never signals danger (Phase 0 §1.3).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, className, children, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-variant={variant}
      data-size={size}
      className={cn('mx-button', className)}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
});