import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card border border-border-subtle bg-surface-card/84 shadow-card',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: CardProps) {
  return <div className={cn('space-y-3', className)} {...props} />;
}

export function CardContent({ className, ...props }: CardProps) {
  return <div className={cn('space-y-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: CardProps) {
  return <div className={cn('space-y-4', className)} {...props} />;
}
