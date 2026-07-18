import type { ComponentProps, FormHTMLAttributes } from 'react';

import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type CardProps = ComponentProps<typeof Card>;
type FormProps = FormHTMLAttributes<HTMLFormElement>;

export function AuthCard({ className, ...props }: CardProps) {
  return <Card className={cn('auth-card w-full max-w-110 p-8', className)} {...props} />;
}

export function AuthCardContent({ className, ...props }: CardProps) {
  return <CardContent className={cn('auth-card-content mt-7', className)} {...props} />;
}

export function AuthCardFooter({ className, ...props }: CardProps) {
  return (
    <CardFooter
      className={cn(
        'auth-card-footer mt-7 border-t border-border-subtle pt-6 text-center text-sm text-text-secondary',
        className,
      )}
      {...props}
    />
  );
}

export function AuthForm({ className, ...props }: FormProps) {
  return <form className={cn('auth-form space-y-5', className)} {...props} />;
}
