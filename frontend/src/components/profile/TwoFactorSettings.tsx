import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionTitle } from '@/components/ui/section-title';
import { SECTION_TITLE_SIZE } from '@/components/profile/section-title-size';
import { twoFactorSchema, type TwoFactorFormValues } from '@/lib/login-schema';
import {
  disableTwoFactor,
  disableTwoFactorErrorMessage,
  enableTwoFactor,
  enableTwoFactorErrorMessage,
  startTwoFactorSetup,
  startTwoFactorSetupErrorMessage,
} from '@/lib/profile-mutations';
import { useReturnFocus } from '@/lib/use-return-focus';
import { useAuthStore } from '@/stores/auth-store';

type Mode = 'idle' | 'setup' | 'disabling';
type Setup = { secret: string; qrCodeDataUrl: string };

type TwoFactorSettingsProps = {
  /** The page's single live region — see the note in `pages/profile.tsx`. */
  announce: (message: string) => void;
};

export function TwoFactorSettings({ announce }: TwoFactorSettingsProps) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [mode, setMode] = useState<Mode>('idle');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { ref: headingRef, returnFocus } = useReturnFocus<HTMLHeadingElement>();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TwoFactorFormValues>({
    resolver: zodResolver(twoFactorSchema),
    defaultValues: { code: '' },
  });

  if (!user) return null;

  // Rebound after the guard: the narrowing does not reach the callbacks below.
  const currentUser = user;

  function resetFlow() {
    setActionError(null);
    // Dropped as soon as the flow ends: the secret has no reason to outlive the setup, on
    // screen or in memory.
    setSetup(null);
    reset({ code: '' });
    setMode('idle');
  }

  async function startSetup() {
    setActionError(null);
    setBusy(true);
    try {
      const { secret, qrCodeDataUrl } = await startTwoFactorSetup();
      setSetup({ secret, qrCodeDataUrl });
      reset({ code: '' });
      setMode('setup');
    } catch (err) {
      setActionError(startTwoFactorSetupErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onEnable(values: TwoFactorFormValues) {
    setActionError(null);
    try {
      await enableTwoFactor({ code: values.code });
      // The route answers `{ ok: true }`, not a user: the one flag it changed is patched in.
      setUser({ ...currentUser, totpEnabled: true });
      resetFlow();
      announce('Two-factor authentication is on.');
      // The whole form is unmounting behind us — focus would land on <body> otherwise.
      returnFocus();
    } catch (err) {
      setActionError(enableTwoFactorErrorMessage(err));
    }
  }

  async function onDisable(values: TwoFactorFormValues) {
    setActionError(null);
    try {
      await disableTwoFactor({ code: values.code });
      setUser({ ...currentUser, totpEnabled: false });
      resetFlow();
      announce('Two-factor authentication is off.');
      returnFocus();
    } catch (err) {
      setActionError(disableTwoFactorErrorMessage(err));
    }
  }

  // Champ code 6 chiffres, partagé par les flux enable et disable.
  const codeField = (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="totp-code">Authentication code</Label>
      <Input
        id="totp-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="123456"
        {...register('code')}
        aria-invalid={errors.code ? true : undefined}
      />
      {errors.code && <FormMessage>{errors.code.message}</FormMessage>}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <SectionTitle headingRef={headingRef} headingClassName={SECTION_TITLE_SIZE}>
          Two-factor authentication
        </SectionTitle>
        <span className="text-text-primary">{user.totpEnabled ? 'Enabled' : 'Disabled'}</span>
      </div>

      {mode === 'idle' &&
        (user.totpEnabled ? (
          <Button
            variant="danger"
            className="self-start"
            onClick={() => {
              setActionError(null);
              reset({ code: '' });
              setMode('disabling');
            }}
          >
            Disable 2FA
          </Button>
        ) : (
          <Button variant="secondary" className="self-start" onClick={startSetup} disabled={busy}>
            {busy ? 'Loading…' : 'Enable 2FA'}
          </Button>
        ))}

      {/* 🔑 `startSetup` est le SEUL handler qui part de `idle`, et `setMode('setup')` est sa
          dernière instruction : quand la requête échoue, le mode ne bascule jamais. Sans cette
          ligne, `actionError` est calculé puis rendu dans aucun des deux autres blocs — le
          bouton clignote « Loading… » et l'utilisateur n'apprend rien, pas même un 429 qui lui
          dirait d'attendre. `FormMessage` porte `role="alert"`, donc l'échec redevient aussi
          audible (WCAG 3.3.1). Gardé par le check 8.1. */}
      {mode === 'idle' && actionError && <FormMessage>{actionError}</FormMessage>}

      {mode === 'setup' && (
        <form onSubmit={handleSubmit(onEnable)} className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            Scan this QR code with your authenticator app, then enter the generated code.
          </p>
          {setup && (
            <>
              {/* Pas de `bg-white` : le PNG rendu par le backend porte déjà sa marge blanche,
                  et une couleur en dur sortirait des tokens du design system. */}
              <img
                src={setup.qrCodeDataUrl}
                alt="Two-factor authentication QR code"
                className="size-44 rounded-control"
              />

              {/* 🔑 Le secret est affiché, pas seulement encodé dans le QR. Sans lui, deux
                  personnes ne peuvent PAS activer la 2FA du tout : celle dont l'application
                  TOTP tourne sur la même machine (aucune caméra pour photographier son propre
                  écran) et celle qui utilise un lecteur d'écran, pour qui une image de QR est
                  muette. `openapi.yaml` documente ce champ comme « à saisir manuellement si
                  besoin ». Neutre côté sécurité : c'est exactement ce que le QR contient déjà.
                  `select-all` : un clic sélectionne la clé entière, prête à copier. */}
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-text-secondary">
                  No camera? Enter this key in your app instead:
                </span>
                <code className="select-all break-all rounded-control border border-border-subtle px-3 py-2 font-mono text-sm tracking-wider text-text-primary">
                  {setup.secret}
                </code>
              </div>
            </>
          )}
          {codeField}
          {actionError && <FormMessage>{actionError}</FormMessage>}
          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Enabling…' : 'Enable'}
            </Button>
            <Button type="button" variant="secondary" onClick={resetFlow} disabled={isSubmitting}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === 'disabling' && (
        <form onSubmit={handleSubmit(onDisable)} className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            Enter a code from your authenticator app to turn off two-factor authentication.
          </p>
          {codeField}
          {actionError && <FormMessage>{actionError}</FormMessage>}
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={isSubmitting}>
              {isSubmitting ? 'Disabling…' : 'Disable'}
            </Button>
            <Button type="button" variant="secondary" onClick={resetFlow} disabled={isSubmitting}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
