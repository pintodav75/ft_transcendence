import type { ComponentPropsWithRef } from 'react';

import { cn } from '@/lib/utils';

type SelectProps = ComponentPropsWithRef<'select'>;

/**
 * Native `<select>`, styled like `Input` so the two sit on the same line without looking like
 * two different form systems.
 */
export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        'h-12 w-full rounded-control border border-border-control bg-surface-input px-3 text-sm text-text-primary outline-none transition focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-arena-red aria-invalid:focus:border-arena-red aria-invalid:focus:ring-arena-red/20',
        className,
      )}
      {...props}
    />
  );
}
