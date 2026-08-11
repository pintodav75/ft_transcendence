import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { LadderSelect } from '@/components/home/LadderSelect';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { ImagePicker } from '@/components/ui/image-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { uploadFile } from '@/lib/upload';
import { createTeamSchema, NAME_MAX_LENGTH, type CreateTeamFormValues } from '@/lib/create-team-schema';

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
  /**
   * Ladder pre-picked by the caller — `/teams?create=<id>`, set by a game page so the user does
   * not have to choose the ladder he has just chosen.
   */
  defaultLadderId?: string;
  // Called after a successful create with the team's name, so the parent can refresh its list
  // and name the team in its success banner.
  onCreated: (teamName: string, warning?: string) => Promise<void>;
  // Closes the form without creating anything — lives inside the form now.
  onCancel: () => void;
};

export function TeamCreation({ defaultLadderId, onCreated, onCancel }: TeamCreationProps) {
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUploadProgress, setLogoUploadProgress] = useState<number | null>(null);

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
    defaultValues: { ladderId: defaultLadderId ?? '', name: '' },
  });

  // `useWatch` rather than the form's `watch()` method: the latter breaks the React Compiler's
  // memoization guarantees (flagged by react-hooks/incompatible-library).
  const name = useWatch({ control, name: 'name' });

  const ladderError = dirtyFields.ladderId || isSubmitted ? errors.ladderId?.message : undefined;
  const nameError = dirtyFields.name || isSubmitted ? errors.name?.message : undefined;

  const submitValidatedForm = handleSubmit(async (values) => {
    clearErrors('root.server');

    let createdTeam: Team;

    try {
      // The 201 carries the raw team row, which lacks the ladder and game names the list
      // renders — refetching (onCreated) is simpler than rebuilding them here.
      const response = await apiFetch<{ team: Team }>('/teams', {
        method: 'POST',
        body: { ladderId: values.ladderId, name: values.name },
      });
      createdTeam = response.team;
    } catch (creationError) {
      if (creationError instanceof ApiError && creationError.status === 409) {
        // Two distinct causes share the 409: name already taken on this ladder (field-level),
        // or the user is already in a team on this ladder (not about any single field).
        const conflict = conflictOf(creationError.payload);
        setError(conflict?.code === 'name_taken' ? 'name' : 'root.server', {
          type: 'server',
          message: conflict?.error ?? 'Could not create the team.',
        });
        return;
      }

      if (creationError instanceof ApiError && creationError.status === 400) {
        // A Zod rejection answers { errors: [...] }, so ApiError has no message to show —
        // client-side validation should already have caught this, but stay generic and readable
        // just in case.
        setError('root.server', {
          type: 'server',
          message: `Pick a ladder and a name of 1 to ${NAME_MAX_LENGTH} characters.`,
        });
        return;
      }

      setError('root.server', { type: 'server', message: 'Could not create the team.' });
      return;
    }

    // The team exists from this point on no matter what happens below: a failed logo upload
    // must never look like a failed team creation.
    let logoUploadWarning: string | undefined;

    if (logoFile) {
      try {
        setLogoUploadProgress(0);
        await uploadFile(`/teams/${createdTeam.id}/logo`, logoFile, {
          field: 'logo',
          onProgress: setLogoUploadProgress,
        });
      } catch {
        logoUploadWarning =
          'Team created, but the logo could not be uploaded — please try again in a moment.';
      } finally {
        setLogoUploadProgress(null);
      }
    }

    await onCreated(createdTeam.name, logoUploadWarning);
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
              // Needed IN ADDITION to `defaultValues` above: the picker announces its own
              // default as soon as its lists land, which would otherwise overwrite ours.
              initialLadderId={defaultLadderId}
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

        <div className="space-y-2">
          <Label>Team logo</Label>
          <ImagePicker
            label="team logo"
            value={logoFile}
            onChange={setLogoFile}
            progress={logoUploadProgress}
            disabled={isSubmitting}
          />
          <p className="text-xs text-text-muted">
            Not required — you can leave it empty and add a logo later from the team page.
          </p>
        </div>
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
