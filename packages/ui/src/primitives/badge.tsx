import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: ReactNode;
}

/**
 * A badge always carries a text label. State is never colour alone (Phase 0
 * §1.5), so `icon` supplements the label rather than replacing it.
 */
export function Badge({ tone = 'neutral', icon, className, children, ...props }: BadgeProps) {
  return (
    <span data-tone={tone} className={cn('mx-badge', className)} {...props}>
      {icon ? <span className="mx-badge__icon">{icon}</span> : null}
      {children}
    </span>
  );
}
