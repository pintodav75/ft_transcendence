import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

type FormMessageProps = HTMLAttributes<HTMLParagraphElement>;

export function FormMessage({ className, role = 'alert', ...props }: FormMessageProps) {
  return <p role={role} className={cn('text-xs text-arena-red', className)} {...props} />;
}
