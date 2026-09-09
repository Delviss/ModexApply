import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: 1 | 2 | 3;
  padding?: 'none' | 'md' | 'lg';
}

export function Card({ elevation = 1, padding = 'md', className, ...props }: CardProps) {
  return (
    <div
      data-elevation={elevation}
      data-padding={padding === 'none' ? undefined : padding}
      className={cn('mx-card', className)}
      {...props}
    />
  );
}

export function CardHeader({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="mx-card__header">
      <h3 className="mx-card__title">{title}</h3>
      {description ? <p className="mx-card__description">{description}</p> : null}
    </div>
  );
}
