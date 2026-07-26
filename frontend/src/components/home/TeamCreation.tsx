import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { LadderSelect } from '@/components/home/LadderSelect';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  createTeamSchema,
  LOGO_URL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  type CreateTeamFormValues,
} from '@/lib/create-team-schema';

import type { components } from '@/lib/api-types.gen';

type Team = components['schemas']['Team'];
type TeamCreateConflict = components['schemas']['TeamCreateConflict'];

// Le 409 de POST /teams porte un `code` stable en plus du message d'affichage.
// `ApiError.payload` est un `unknown` : on le rétrécit ici plutôt que de caster.
function conflictOf(payload: unknown): TeamCreateConflict | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  if (!('code' in payload) || !('error' in payload)) return undefined;
  const { code, error } = payload as Record<'code' | 'error', unknown>;
  if (typeof code !== 'string' || typeof error !== 'string') return undefined;
  return { code, error } as TeamCreateConflict;
}

type TeamCreationProps = {
  // Called after a successful create with the team's name, so the parent can
  // refresh its list and name the team in its success banner.
  onCreated: (teamName: string) => Promise<void>;
  // Closes the form without creating anything — lives inside the form now.
  onCancel: () => void;
};

export function TeamCreation({ onCreated, onCancel }: TeamCreationProps) {
  // The "https:// URL that just doesn't resolve to an image" case: reset on
  // every keystroke so fixing the URL gives the preview another try.
  const [logoPreviewFailed, setLogoPreviewFailed] = useState(false);

  const {
    control,
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { dirtyFields, errors, isSubmitted, isSubmitting },
  } = useForm<CreateTeamFormValues>({
    resolver: zodResolver(createTeamSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { ladderId: '', name: '', logoUrl: '' },
  });

  // `useWatch` rather than the form's `watch()` method: the latter breaks the
  // React Compiler's memoization guarantees (flagged by
  // react-hooks/incompatible-library).
  const name = useWatch({ control, name: 'name' });
  const logoUrl = useWatch({ control, name: 'logoUrl' });

  const ladderError = dirtyFields.ladderId || isSubmitted ? errors.ladderId?.message : undefined;
  const nameError = dirtyFields.name || isSubmitted ? errors.name?.message : undefined;
  const logoUrlError = dirtyFields.logoUrl || isSubmitted ? errors.logoUrl?.message : undefined;

  // Independent from the field's own validation timing (`onTouched`): the
  // preview should appear the moment the URL looks right, not only once the
  // user has blurred the field.
  const trimmedLogoUrl = logoUrl.trim();
  const showLogoPreview =
    trimmedLogoUrl.startsWith('https://') &&
    trimmedLogoUrl.length <= LOGO_URL_MAX_LENGTH &&
    !logoPreviewFailed;

  const submitValidatedForm = handleSubmit(async (values) => {
    clearErrors('root.server');

    try {
      // The 201 carries the raw team row, which lacks the ladder and game
      // names the list renders — refetching (onCreated) is simpler than
      // rebuilding them here.
      const response = await apiFetch<{ team: Team }>('/teams', {
        method: 'POST',
        body: {
          ladderId: values.ladderId,
          name: values.name,
          // Never send an empty (or null) key: both are rejected by POST
          // /teams the same way a malformed URL is.
          ...(values.logoUrl ? { logoUrl: values.logoUrl } : {}),
        },
      });
      await onCreated(response.team.name);
    } catch (creationError) {
      if (creationError instanceof ApiError && creationError.status === 409) {
        // Two distinct causes share the 409: name already taken on this ladder
        // (field-level), or the user is already in a team on this ladder (not
        // about any single field). On se fie au `code` du contrat, jamais au
        // texte de `error` — celui-ci peut être reformulé sans préavis.
        const conflict = conflictOf(creationError.payload);
        setError(conflict?.code === 'name_taken' ? 'name' : 'root.server', {
          type: 'server',
          message: conflict?.error ?? 'Could not create the team.',
        });
        return;
      }

      if (creationError instanceof ApiError && creationError.status === 400) {
        // A Zod rejection answers { errors: [...] }, so ApiError has no
        // message to show — client-side validation should already have
        // caught this, but stay generic and readable just in case.
        setError('root.server', {
          type: 'server',
          message: `Pick a ladder and a name of 1 to ${NAME_MAX_LENGTH} characters.`,
        });
        return;
      }

      setError('root.server', { type: 'server', message: 'Could not create the team.' });
    }
  });

  return (
    <form
      onSubmit={submitValidatedForm}
      noValidate
      className="flex flex-col gap-4 rounded-control border border-border-subtle p-4"
    >
      <div className="flex flex-col gap-2">
        <Label>Ladder</Label>
        <Controller
          control={control}
          name="ladderId"
          render={({ field }) => (
            <LadderSelect
              value={field.value || undefined}
              onChange={(nextLadderId) => field.onChange(nextLadderId ?? '')}
              excludeSolo
            />
          )}
        />
        {ladderError ? <FormMessage role="alert">{ladderError}</FormMessage> : null}
      </div>

      <div className="relative space-y-2">
        <Label htmlFor="team-name">Team name</Label>
        <Input
          id="team-name"
          type="text"
          placeholder="My team"
          aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? 'team-name-error' : 'team-name-count'}
          {...register('name')}
        />
        {/* Pas de `maxLength` natif (convention Register/Login : c'est Zod qui tranche),
            donc le compteur doit lui-même signaler le dépassement — sinon rien n'indique
            pourquoi la soumission va échouer. */}
        <p
          id="team-name-count"
          className={cn(
            'text-xs',
            name.length > NAME_MAX_LENGTH ? 'text-arena-red' : 'text-text-muted',
          )}
        >
          {name.length}/{NAME_MAX_LENGTH}
        </p>
        {nameError ? (
          <FormMessage id="team-name-error" className="absolute left-0 top-full mt-1">
            {nameError}
          </FormMessage>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 rounded-control border border-border-subtle bg-surface-card-strong/40 p-3">
        <p className="label-caps text-xs text-text-muted">Optional</p>

        <div className="relative space-y-2">
          <Label htmlFor="team-logo-url">Logo URL</Label>
          <Input
            id="team-logo-url"
            type="url"
            inputMode="url"
            placeholder="https://example.com/logo.png"
            aria-invalid={Boolean(logoUrlError)}
            aria-describedby={logoUrlError ? 'team-logo-url-error' : 'team-logo-url-hint'}
            {...register('logoUrl', { onChange: () => setLogoPreviewFailed(false) })}
          />
          <p id="team-logo-url-hint" className="text-xs text-text-muted">
            Not required — you can leave it empty and add a logo later from the team page.
          </p>
          {logoUrlError ? (
            <FormMessage id="team-logo-url-error" className="absolute left-0 top-full mt-1">
              {logoUrlError}
            </FormMessage>
          ) : null}
        </div>

        {showLogoPreview && (
          <div className="flex items-center gap-3">
            <img
              src={trimmedLogoUrl}
              alt=""
              className="size-14 rounded-full border border-border-subtle object-cover"
              onError={() => setLogoPreviewFailed(true)}
            />
            <p className="text-xs text-text-muted">Logo preview</p>
          </div>
        )}
        {logoPreviewFailed && trimmedLogoUrl && !logoUrlError && (
          <p className="text-xs text-text-muted">Could not load a preview for this image.</p>
        )}
      </div>

      {errors.root?.server ? <FormMessage>{errors.root.server.message}</FormMessage> : null}

      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating…' : 'Create team'}
        </Button>
        <Button type="button" variant="secondary" disabled={isSubmitting} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
