import type { ComponentPropsWithRef } from 'react';

import { cn } from '@/lib/utils';

type SelectProps = ComponentPropsWithRef<'select'>;

/**
 * Native `<select>`, styled like `Input` so the two sit on the same line without looking
 * like two different form systems.
 *
 * Deliberately NOT a JS listbox: the platform already gives the keyboard behaviour, the
 * type-ahead, the screen-reader announcement and — on a phone — the OS wheel picker. A
 * hand-rolled dropdown would have to earn all four back. `ComponentPropsWithRef` because
 * React Hook Form's `register()` hands the element a ref.
 *
 * `appearance-none` is NOT used: the caret the browser draws is the only affordance that
 * says "this opens a list", and drawing our own would mean an inline background image.
 */
export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        'h-12 w-full rounded-control border border-border-subtle bg-surface-input px-3 text-sm text-text-primary outline-none transition focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-arena-red aria-invalid:focus:border-arena-red aria-invalid:focus:ring-arena-red/20',
        className,
      )}
      {...props}
    />
  );
}
