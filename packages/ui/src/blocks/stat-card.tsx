import type { ReactNode } from 'react';
import { Card } from '../primitives/card.js';
import { Badge } from '../primitives/badge.js';
import { cn } from '../lib/cn.js';

/**
 * Stat Card — re-themed from `@felipemenezes098/card-05`.
 *
 * Per the re-theming note on issue #3: a downward trend badge uses
 * `--mx-danger`, never brand crimson. Brand red means "this is the action" and
 * nothing else; a KPI that fell is a semantic error state, not a brand moment.
 */

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  trend?: { direction: 'up' | 'down' | 'flat'; label: string; isGood?: boolean };
  caption?: ReactNode;
  className?: string;
}

export function StatCard({ label, value, icon, trend, caption, className }: StatCardProps) {
  return (
    <Card className={cn('mx-stat', className)}>
      <div className="mx-stat__head">
        <span className="mx-stat__label">{label}</span>
        {icon ? <span className="mx-stat__icon">{icon}</span> : null}
      </div>
      <span className="mx-stat__value">{value}</span>
      {trend || caption ? (
        <div className="mx-stat__foot">
          {trend ? (
            <Badge tone={trendTone(trend)}>
              {trend.direction === 'up' ? '▲' : trend.direction === 'down' ? '▼' : '■'} {trend.label}
            </Badge>
          ) : null}
          {caption ? <span className="mx-stat__caption">{caption}</span> : null}
        </div>
      ) : null}
    </Card>
  );
}

function trendTone(trend: NonNullable<StatCardProps['trend']>) {
  if (trend.direction === 'flat') return 'neutral' as const;
  // `isGood` decouples direction from judgement: guide safety incidents falling
  // is good, verified scholarship savings falling is not.
  const good = trend.isGood ?? trend.direction === 'up';
  return good ? ('success' as const) : ('danger' as const);
}
