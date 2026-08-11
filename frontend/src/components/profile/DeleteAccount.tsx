import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { SectionTitle } from '@/components/ui/section-title';
import { SECTION_TITLE_SIZE } from '@/components/profile/section-title-size';
import { makeDeleteAccountSchema, type DeleteAccountFormValues } from '@/lib/delete-account-schema';
import { deleteAccount, deleteAccountErrorMessage } from '@/lib/profile-mutations';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Last section of /profile: delete the account for good.
 *
 * what this dialog promises is also written in /privacy §8 (messages erased for the
 * correspondent too, played matches keep their score, no restore, no grace period). reword one
 * and you have to reword the other, or they contradict each other.
 * no `announce` prop, alone among the five sections: on success the account is gone, we sign
 * out and leave, so the live region is unmounted before a reader reaches it. failures render
 * inside the dialog, which stays open.
 */
export function DeleteAccount() {
  // Guaranteed non-null: the route sits behind the `_authenticated` guard.
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const passwordFieldId = useId();
  const totpFieldId = useId();
  /** Landing point for the focus when the dialog opens — see the merged ref below. */
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const hasPassword = user?.hasPassword ?? false;
  const totpEnabled = user?.totpEnabled ?? false;

  const schema = useMemo(
    () => makeDeleteAccountSchema({ hasPassword, totpEnabled }),
    [hasPassword, totpEnabled],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DeleteAccountFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', totpCode: '' },
  });

  const { ref: registerPasswordRef, ...passwordField } = register('password');
  const { ref: registerTotpRef, ...totpField } = register('totpCode');

  function close() {
    setSubmitError(null);
    reset({ password: '', totpCode: '' });
    setConfirming(false);
  }

  async function onSubmit(values: DeleteAccountFormValues) {
    setSubmitError(null);
    try {
      // Only what the account actually carries: sending `password: ''` for an OAuth-only
      // account would be a claim the form cannot back.
      await deleteAccount({
        ...(hasPassword ? { password: values.password } : {}),
        ...(totpEnabled ? { totpCode: values.totpCode.trim() } : {}),
      });
      // The session is dead server-side; `logout()` drops the local one and closes the
      // WebSocket, so nothing left mounted can fire a request as the account that just left.
      await logout();
      navigate({ to: '/' });
    } catch (err) {
      setSubmitError(
        deleteAccountErrorMessage(err, { password: hasPassword, totpCode: totpEnabled }),
      );
    }
  }

  if (!user) return null;

  // No field at all for an OAuth-only account without 2FA: `ConfirmDialog` then renders no
  // `<form>` and confirmation is the button alone, which is exactly what the route accepts.
  const credentialFields =
    hasPassword || totpEnabled ? (
      <div className="flex flex-col gap-4">
        {hasPassword && (
          <div className="flex flex-col gap-1.5">

            <input type="text" autoComplete="username" value={user.email} readOnly hidden />
            <Label htmlFor={passwordFieldId}>Password</Label>
            <PasswordInput
              id={passwordFieldId}
              autoComplete="current-password"
              {...passwordField}
              ref={(node) => {
                registerPasswordRef(node);
                firstFieldRef.current = node;
              }}
              aria-invalid={errors.password ? true : undefined}
            />
            {errors.password && <FormMessage>{errors.password.message}</FormMessage>}
          </div>
        )}

        {totpEnabled && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={totpFieldId}>Authentication code</Label>
            <Input
              id={totpFieldId}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              {...totpField}
              ref={(node) => {
                registerTotpRef(node);
                // Only when there is no password field above it.
                if (!hasPassword) firstFieldRef.current = node;
              }}
              aria-invalid={errors.totpCode ? true : undefined}
            />
            {errors.totpCode && <FormMessage>{errors.totpCode.message}</FormMessage>}
          </div>
        )}
      </div>
    ) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle headingClassName={SECTION_TITLE_SIZE}>Delete account</SectionTitle>

      <p className="text-sm text-text-secondary">
        Deleting your account is immediate and cannot be undone.
      </p>

      <Button variant="danger" className="self-end" onClick={() => setConfirming(true)}>
        Delete account
      </Button>

      <ConfirmDialog
        open={confirming}
        title="Delete your account?"
        description={
          <>
            This erases your profile, your linked game accounts, your friendships and every private
            message you sent or received — including for the people you sent them to. Matches you
            have already played keep their score and their Elo, but your name leaves their line-ups.
            There is no restore.
          </>
        }
        confirmLabel="Delete my account"
        pending={isSubmitting}
        error={submitError}
        onConfirm={() => void handleSubmit(onSubmit)()}
        onCancel={close}
        initialFocusRef={firstFieldRef}
      >

        {confirming ? credentialFields : undefined}
      </ConfirmDialog>
    </div>
  );
}
