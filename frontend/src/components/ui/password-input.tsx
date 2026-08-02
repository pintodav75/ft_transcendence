import { useState } from 'react';
import type { ComponentPropsWithRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ComponentPropsWithRef, not InputHTMLAttributes: same prop set PLUS `ref`, which React 19
// passes to function components like any other prop. Needed as soon as a caller has to move
// focus into the field — `ConfirmDialog` focuses the first field of a form dialog on open.
// Same note as `Button` and `Input`.
type PasswordInputProps = Omit<ComponentPropsWithRef<'input'>, 'type'> & {
  hidePasswordLabel?: string;
  showPasswordLabel?: string;
};

export function PasswordInput({
  className,
  hidePasswordLabel = 'Hide password',
  showPasswordLabel = 'Show password',
  ...props
}: PasswordInputProps) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const visibilityLabel = passwordVisible ? hidePasswordLabel : showPasswordLabel;

  return (
    <div className="relative">
      <Input
        type={passwordVisible ? 'text' : 'password'}
        className={cn('pr-12', className)}
        {...props}
      />
      <button
        type="button"
        className="absolute right-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-control text-text-secondary transition hover:text-text-primary focus-ring focus-visible:outline-offset-2"
        aria-label={visibilityLabel}
        aria-pressed={passwordVisible}
        title={visibilityLabel}
        onClick={() => setPasswordVisible((visible) => !visible)}
      >
        {passwordVisible ? (
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Eye className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
