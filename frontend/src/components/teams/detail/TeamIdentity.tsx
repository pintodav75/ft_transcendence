import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { ImagePicker } from '@/components/ui/image-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionTitle } from '@/components/ui/section-title';
import { NAME_MAX_LENGTH, createTeamSchema } from '@/lib/create-team-schema';
import {
  updateTeamErrorMessage,
  uploadTeamLogoErrorMessage,
  useUpdateTeam,
  useUploadTeamLogo,
} from '@/lib/team-mutations';
import { cn } from '@/lib/utils';

import type { CreateTeamFormValues } from '@/lib/create-team-schema';
import type { TeamDetail } from '@/lib/team-detail';

// The SAME name rule as team creation, taken from the creation schema instead of restated: two
// copies of "1 to 50, trimmed" would drift the day the backend bound moves, and the mismatch
// would only show up as a 400 in production.
const renameSchema = createTeamSchema.pick({ name: true });
type RenameValues = Pick<CreateTeamFormValues, 'name'>;

type TeamIdentityProps = {
  team: TeamDetail;
};

export function TeamIdentity({ team }: TeamIdentityProps) {
  const nameFieldId = useId();
  const countId = useId();
  const errorId = useId();

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const rename = useUpdateTeam(team.id);
  // A SECOND instance of the same hook on purpose: rename and "remove logo" both go through
  // PATCH /teams/{id}, but sharing one mutation would make the logo's failure land under the
  // name field (and vice versa).
  const clearLogo = useUpdateTeam(team.id);
  // `setUploadProgress` is handed to the hook, which forwards it to uploadFile's XHR — that is
  // the only source of a real upload percentage (fetch has no such event).
  const uploadLogo = useUploadTeamLogo(team.id, setUploadProgress);

  const {
    control,
    register,
    handleSubmit,
    setError,
    clearErrors,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RenameValues>({
    resolver: zodResolver(renameSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { name: team.name },
  });

  // `useWatch` rather than the form's `watch()`: the latter is flagged by
  // react-hooks/incompatible-library (it breaks the compiler's memoization).
  const name = useWatch({ control, name: 'name' });
  // PATCH with an unchanged body is a pointless round trip, and an EMPTY body is a 400 — so the
  // button is disabled until the name really differs.
  const unchanged = name.trim() === team.name;
  const nameError = errors.name?.message;

  const submit = handleSubmit(async (values) => {
    clearErrors('root.server');

    try {
      await rename.mutateAsync({ name: values.name.trim() });
      // Re-baselines the form on the value the server now holds, so the Save button goes back
      // to "nothing to save" instead of staying enabled against a stale default.
      reset({ name: values.name.trim() });
    } catch (error) {
      // 409 = name already taken on this ladder, and it belongs UNDER the field. Anything else
      // is form-level. The mapping lives in team-mutations, not here.
      const { field, message } = updateTeamErrorMessage(error);
      setError(field ?? 'root.server', { type: 'server', message });
    }
  });

  function handleLogoPicked(file: File | null) {
    setLogoFile(file);
    // ImagePicker also calls onChange(null) from its own "Remove" button — that only drops the
    // local pick, it must not touch the team.
    if (!file) return;

    clearLogo.reset();
    // 0 rather than null: ImagePicker renders its progress bar (and disables itself) as soon as
    // `progress` is a number, so the bar exists from the very first byte.
    setUploadProgress(0);
    uploadLogo.mutate(file, {
      // The uploaded logo is now the team's logo, served from /media: the local blob preview
      // has nothing left to show.
      onSuccess: () => setLogoFile(null),
      onSettled: () => setUploadProgress(null),
    });
  }

  const uploadError = uploadLogo.isError ? uploadTeamLogoErrorMessage(uploadLogo.error) : null;
  const clearLogoError = clearLogo.isError ? updateTeamErrorMessage(clearLogo.error).message : null;

  return (
    <section className="flex flex-col gap-3.5">
      <SectionTitle>Identity</SectionTitle>

      <div className="grid gap-x-6 gap-y-6 sm:grid-cols-2">
        <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={nameFieldId}>Team name</Label>
          <Input
            id={nameFieldId}
            type="text"
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? errorId : countId}
            {...register('name')}
          />

          <p
            id={countId}
            className={cn(
              'text-xs',
              name.length > NAME_MAX_LENGTH ? 'text-arena-red' : 'text-text-muted',
            )}
          >
            {name.length}/{NAME_MAX_LENGTH} · unique on this ladder
          </p>
          {nameError ? <FormMessage id={errorId}>{nameError}</FormMessage> : null}
          {errors.root?.server ? <FormMessage>{errors.root.server.message}</FormMessage> : null}
          {rename.isSuccess && unchanged && !nameError ? (
            <p role="status" className="text-xs text-success">
              Team name saved.
            </p>
          ) : null}

          <div className="mt-auto flex pt-1">
            <Button type="submit" disabled={unchanged || isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save name'}
            </Button>
          </div>
        </form>

        <div className="flex min-w-0 flex-col gap-2">
          <Label>Team logo</Label>
          <div className="flex flex-wrap items-center gap-3">

            {logoFile ? null : (
              <Avatar
                src={team.logoUrl ?? undefined}
                alt=""
                fallback={team.name.slice(0, 2).toUpperCase()}
                className="size-14 shrink-0"
              />
            )}
            <ImagePicker
              label="team logo"
              value={logoFile}
              onChange={handleLogoPicked}
              progress={uploadProgress}
              className="min-w-32 grow"
            />
          </div>
          <p className="text-xs text-text-muted">
            JPEG, PNG or WebP · 2 MB max · sent as soon as you pick a file.
          </p>

          {uploadError ? <FormMessage>{uploadError}</FormMessage> : null}
          {clearLogoError ? <FormMessage>{clearLogoError}</FormMessage> : null}

          {team.logoUrl && !logoFile ? (
            <Button
              variant="ghost"
              className="mt-auto self-start"
              disabled={clearLogo.isPending}
              onClick={() => clearLogo.mutate({ logoUrl: null })}
            >
              {clearLogo.isPending ? 'Removing the logo…' : 'Remove logo'}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
