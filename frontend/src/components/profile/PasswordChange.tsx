import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { FormMessage } from '@/components/ui/form-message';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { SectionTitle } from '@/components/ui/section-title';
import { SECTION_TITLE_SIZE } from '@/components/profile/section-title-size';
import { passwordChangeSchema, type PasswordChangeFormValues } from '@/lib/password-schema';
import { changePassword, changePasswordErrorMessage } from '@/lib/profile-mutations';
import { useReturnFocus } from '@/lib/use-return-focus';
import { useAuthStore } from '@/stores/auth-store';

/** How long the success line stays on screen before clearing itself. */
const SUCCESS_TIMEOUT_MS = 6000;

type PasswordChangeProps = {
  /** The page's single live region — see the note in `pages/profile.tsx`. */
  announce: (message: string) => void;
};

export function PasswordChange({ announce }: PasswordChangeProps) {
  const user = useAuthStore((s) => s.user);
  const [editing, setEditing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const { ref: headingRef, returnFocus } = useReturnFocus<HTMLHeadingElement>();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordChangeFormValues>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  // The confirmation used to stay up for as long as the page was open, so a password changed
  // ten minutes ago still read as if it had just happened.
  useEffect(() => {
    if (!success) return;

    const timer = setTimeout(() => setSuccess(false), SUCCESS_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [success]);

  function close() {
    setSubmitError(null);
    reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
    setEditing(false);
  }

  async function onSubmit(values: PasswordChangeFormValues) {
    setSubmitError(null);
    try {
      await changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      setSuccess(true);
      close();
      announce('Password updated.');
      // The Save button is being unmounted by `close()`: without this, focus would land on
      // <body> and a keyboard user would be thrown back to the top of the page.
      returnFocus();
    } catch (err) {
      setSubmitError(changePasswordErrorMessage(err));
    }
  }

  // An account with no local password has nothing to change: the route answers 400 for every
  // attempt, so offering the form would be a guaranteed dead end — and a red console line on
  // each try, which the console audit counts.
  //
  // 🔑 The test is `hasPassword`, NEVER `oauthProvider`, and the two are not interchangeable:
  // signing in with Google from an account that already existed by email links the provider
  // WITHOUT dropping the password (`auth/google.ts`, linking case B). Such an account has
  // both, and must keep the form — it is the server's own test (`passwordHash !== null`,
  // exposed by `toAuthUser()`).
  if (user && !user.hasPassword) {
    // Provider capitalised for display: the column stores it lowercase ('google'). The
    // fallback is unreachable today — no password means the account was created by OAuth —
    // but `oauthProvider` is nullable at the contract, so the wording must not depend on it.
    const provider = user.oauthProvider
      ? user.oauthProvider[0].toUpperCase() + user.oauthProvider.slice(1)
      : 'your identity provider';

    return (
      <div className="flex flex-col gap-4">
        <SectionTitle headingClassName={SECTION_TITLE_SIZE}>Password</SectionTitle>
        <Callout>Managed by {provider}</Callout>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle headingRef={headingRef} headingClassName={SECTION_TITLE_SIZE}>
        Password
      </SectionTitle>

      {success && !editing && <Callout tone="success">Password updated.</Callout>}

      {editing ? (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {/* Chrome exige un champ d'identifiant dans TOUT formulaire de mot de passe, et
              écrit sinon un avertissement en console (« Password forms should have
              (optionally hidden) username fields for accessibility ») — or la console propre
              est un motif de rejet du projet. Ce n'est pas que du silence acheté : sans lui,
              un gestionnaire de mots de passe ne sait pas à QUEL compte rattacher le nouveau
              mot de passe. Caché, en lecture seule, et hors de l'ordre de tabulation : il
              informe le navigateur sans rien ajouter au parcours de l'utilisateur. */}
          <input
            type="text"
            autoComplete="username"
            value={user?.email ?? ''}
            readOnly
            hidden
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="currentPassword">Current password</Label>
            <PasswordInput
              id="currentPassword"
              autoComplete="current-password"
              {...register('currentPassword')}
              aria-invalid={errors.currentPassword ? true : undefined}
            />
            {errors.currentPassword && (
              <FormMessage>{errors.currentPassword.message}</FormMessage>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <PasswordInput
              id="newPassword"
              autoComplete="new-password"
              {...register('newPassword')}
              aria-invalid={errors.newPassword ? true : undefined}
            />
            {errors.newPassword && <FormMessage>{errors.newPassword.message}</FormMessage>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <PasswordInput
              id="confirmPassword"
              autoComplete="new-password"
              {...register('confirmPassword')}
              aria-invalid={errors.confirmPassword ? true : undefined}
            />
            {errors.confirmPassword && (
              <FormMessage>{errors.confirmPassword.message}</FormMessage>
            )}
          </div>

          {submitError && <FormMessage>{submitError}</FormMessage>}

          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isSubmitting}
              onClick={() => {
                close();
                returnFocus();
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => {
            setSuccess(false);
            setEditing(true);
          }}
        >
          Change password
        </Button>
      )}
    </div>
  );
}
