import { cn } from '../lib/cn.js';

export function Skeleton({
  width = '100%',
  height = 16,
  className,
}: {
  width?: string | number;
  height?: string | number;
  className?: string;
}) {
  return (
    <span
      className={cn('mx-skeleton', className)}
      style={{ display: 'block', width, height }}
      aria-hidden="true"
    />
  );
}

export interface ProgressProps {
  value: number;
  max?: number;
  label: string;
}

export function Progress({ value, max = 100, label }: ProgressProps) {
  const clamped = Math.max(0, Math.min(value, max));
  const percent = max === 0 ? 0 : (clamped / max) * 100;
  return (
    <div
      className="mx-progress"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <span className="mx-progress__bar" style={{ width: `${percent}%` }} />
    </div>
  );
}
