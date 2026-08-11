import type { TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

// Calqué sur Input, en multi-ligne (pas de hauteur fixe h-12, padding vertical).
export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full rounded-control border border-border-control bg-surface-input px-4 py-3 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/20 aria-invalid:border-arena-red aria-invalid:focus:border-arena-red aria-invalid:focus:ring-arena-red/20',
        className,
      )}
      {...props}
    />
  );
}
