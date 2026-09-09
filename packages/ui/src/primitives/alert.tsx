import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { AlertTriangleIcon, CheckIcon, InfoIcon, XCircleIcon } from './icons.js';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const ICONS = {
  info: InfoIcon,
  success: CheckIcon,
  warning: AlertTriangleIcon,
  danger: XCircleIcon,
} as const;

export interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Alert({ tone = 'info', title, children, className }: AlertProps) {
  const IconComponent = ICONS[tone];
  return (
    <div
      data-tone={tone}
      className={cn('mx-alert', className)}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <span className="mx-alert__icon">
        <IconComponent size={18} />
      </span>
      <div>
        {title ? <div className="mx-alert__title">{title}</div> : null}
        <div className="mx-alert__body">{children}</div>
      </div>
    </div>
  );
}
