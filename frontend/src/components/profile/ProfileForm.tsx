import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionTitle } from '@/components/ui/section-title';
import { SECTION_TITLE_SIZE } from '@/components/profile/section-title-size';
import { Textarea } from '@/components/ui/textarea';
import { profileSchema, type ProfileFormValues } from '@/lib/profile-schema';
import { updateProfile, updateProfileErrorMessage } from '@/lib/profile-mutations';
import { useReturnFocus } from '@/lib/use-return-focus';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';

function ReadOnlyRow({
  label,
  value,
  valueClassName,
  placeholder = '—',
}: {
  label: string;
  value: string | null;
  valueClassName?: string;
  placeholder?: string;
}) {
  // Vide = null OU chaîne blanche : on retombe sur le placeholder muté.
  const isEmpty = value == null || value.trim() === '';
  return (
    <div className="flex flex-col gap-1">
      <span className="label-caps text-text-secondary">{label}</span>
      <span className={cn('whitespace-pre-wrap text-text-primary', valueClassName)}>
        {isEmpty ? <span className="text-text-secondary">{placeholder}</span> : value}
      </span>
    </div>
  );
}

type ProfileFormProps = {
  /** The page's single live region — see the note in `pages/profile.tsx`. */
  announce: (message: string) => void;
};

export function ProfileForm({ announce }: ProfileFormProps) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [editing, setEditing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { ref: headingRef, returnFocus } = useReturnFocus<HTMLHeadingElement>();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: '', bio: '' },
  });

  if (!user) return null;

  // Rebound after the guard: TypeScript does not carry the narrowing into the callbacks
  // below, which is why they each used to end up with a `user!`.
  const currentUser = user;

  /**
   * The nickname is now required (see `profile-schema.ts`), so the field must never open
   * empty — otherwise an account that never set one could not save its bio without being
   * forced to invent a nickname first. Falling back on the pseudo is what the page already
   * DISPLAYS above the form (`displayName ?? pseudo`), so the prefilled value is the one
   * the user sees as their name today: saving it changes nothing on screen.
   */
  function editableValues() {
    return {
      displayName: currentUser.displayName ?? currentUser.pseudo,
      bio: currentUser.bio ?? '',
    };
  }

  function startEdit() {
    setSubmitError(null);
    reset(editableValues());
    setEditing(true);
  }

  function cancelEdit() {
    setSubmitError(null);
    reset(editableValues());
    setEditing(false);
    // The Cancel button is unmounting with the form; without this, focus falls to <body>.
    returnFocus();
  }

  async function onSubmit(values: ProfileFormValues) {
    setSubmitError(null);
    try {
      // Both fields go out every time. `displayName` used to be dropped when empty, which is
      // exactly what made an erased nickname look saved; it can no longer BE empty.
      const updated = await updateProfile({ displayName: values.displayName, bio: values.bio });
      if (updated) setUser(updated);
      setEditing(false);
      announce('Profile saved.');
      returnFocus();
    } catch (err) {
      setSubmitError(updateProfileErrorMessage(err));
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-4">
        <SectionTitle headingRef={headingRef} headingClassName={SECTION_TITLE_SIZE}>
          Details
        </SectionTitle>
        <ReadOnlyRow
          label="Bio"
          value={user.bio}
          valueClassName="max-w-[60ch] break-words @lg:max-w-[40ch]"
          placeholder="No bio yet."
        />
        <ReadOnlyRow label="Email" value={user.email} valueClassName="break-all" />
        <ReadOnlyRow
          label="Sign-in"
          value={user.oauthProvider ? `OAuth (${user.oauthProvider})` : 'Email / password'}
        />
        {/* En fin de bloc : au milieu, entre Bio et Email, il coupait la liste de données
            en deux et se lisait comme s'il n'agissait que sur la Bio. */}
        <Button variant="secondary" className="self-start" onClick={startEdit}>
          Edit profile
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 @lg:min-w-[40ch]">
      {/* Le même titre dans les deux états : la section garde son nom quand on bascule en
          édition, et la ref de focus reste valide au retour. */}
      <SectionTitle headingRef={headingRef} headingClassName={SECTION_TITLE_SIZE}>
        Details
      </SectionTitle>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="displayName">Nickname</Label>
        <Input
          id="displayName"
          {...register('displayName')}
          aria-invalid={errors.displayName ? true : undefined}
        />
        {errors.displayName && <FormMessage>{errors.displayName.message}</FormMessage>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bio">Bio</Label>
        <Textarea
          id="bio"
          rows={4}
          {...register('bio')}
          aria-invalid={errors.bio ? true : undefined}
        />
        {errors.bio && <FormMessage>{errors.bio.message}</FormMessage>}
      </div>

      {submitError && <FormMessage>{submitError}</FormMessage>}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="secondary" onClick={cancelEdit} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
