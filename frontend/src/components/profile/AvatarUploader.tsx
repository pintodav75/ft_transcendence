import { useEffect, useMemo, useRef, useState } from 'react';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormMessage } from '@/components/ui/form-message';
import { ProgressBar } from '@/components/ui/progress-bar';
import { IMAGE_ACCEPT_ATTRIBUTE, imageFileError } from '@/lib/image-file';
import {
  removeAvatar,
  removeAvatarErrorMessage,
  uploadAvatar,
  uploadAvatarErrorMessage,
} from '@/lib/profile-mutations';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Avatar section of /profile: pick a file, look at it big, then confirm or drop it.
 *
 * 🔑 WHY THIS IS NOT `ui/image-picker.tsx` — the arbitration, so nobody has to redo it.
 * Sharing the COMPONENT would have meant switching off most of what it draws: its 56 px
 * thumbnail (this page shows the pick as a 160 px round avatar, the identity of the screen),
 * its round ⊕ trigger (this page names the action in words), and that trigger again while an
 * image waits behind Confirm/Cancel. Three presentation props to reuse a presentation is not
 * reuse — it is `EvidencePicker`'s conclusion, reached from the other side.
 *
 * WHAT IS GENUINELY SHARED IS SHARED, and that is the part that matters: the accepted types,
 * the 2 MB cap and the two refusal sentences live once in `lib/image-file.ts` and are used
 * by BOTH pickers, so the day the server raises the cap there is a single line to change.
 * The progress bar is `ui/progress-bar.tsx`, and the transfer that feeds it is `uploadFile`
 * (XHR — `fetch` has no upload-progress event). No class string of ImagePicker is reproduced
 * here: this control is a big round avatar over labelled buttons, not a thumbnail row.
 */
type AvatarUploaderProps = {
  /** The page's single live region — see the note in `pages/profile.tsx`. */
  announce: (message: string) => void;
};

export function AvatarUploader({ announce }: AvatarUploaderProps) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const inputRef = useRef<HTMLInputElement>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  // null = idle; a number (0-100) renders the bar. Set to 0 before the request leaves, so
  // the bar exists from the very first byte rather than from the first progress event.
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  // Focus lands back here once the removal dialog closes: confirming destroys the "Remove"
  // button that opened it, so the browser would otherwise drop focus on <body>.
  const blockRef = useRef<HTMLDivElement>(null);

  // Derived at render rather than mirrored into state via an effect; the effect below only
  // does what has no render-time equivalent — releasing the previous URL.
  const previewUrl = useMemo(
    () => (pickedFile ? URL.createObjectURL(pickedFile) : null),
    [pickedFile],
  );

  // Revoked when the preview changes AND on unmount: every createObjectURL pins its file in
  // memory until it is released.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  if (!user) return null;

  const initials = (user.displayName ?? user.pseudo).slice(0, 2).toUpperCase();

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    // Reset the raw input value whatever happens: without it, picking the exact same file
    // twice in a row does not fire `change` the second time, so re-picking after a Cancel
    // would silently do nothing.
    event.target.value = '';
    if (!file) return;

    const refusal = imageFileError(file);
    if (refusal) {
      setError(refusal);
      return;
    }

    setError(null);
    setPickedFile(file);
  }

  async function handleConfirm() {
    if (!pickedFile) return;

    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const updated = await uploadAvatar(pickedFile, setProgress);
      if (updated) setUser(updated);
      // The avatar now lives on the server and is served from /media: the local blob has
      // nothing left to show.
      setPickedFile(null);
      announce('Avatar updated.');
      // Confirm is unmounting with the preview state, so focus needs a home.
      blockRef.current?.focus();
    } catch (err) {
      setError(uploadAvatarErrorMessage(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      const updated = await removeAvatar();
      if (updated) setUser(updated);
      setConfirmingRemoval(false);
      announce('Avatar removed.');
    } catch (err) {
      setError(removeAvatarErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    // `role="group"` + `aria-label` rather than a bare focusable <div>: this block is the
    // landing point after an upload or a removal, and an unnamed container announces nothing
    // on arrival. The other three sections get their name from their SectionTitle; this one
    // has no visible heading — the page states the identity through the avatar itself.
    <div
      ref={blockRef}
      tabIndex={-1}
      role="group"
      aria-label="Avatar"
      className="focus-ring flex flex-wrap items-center justify-center gap-4 rounded-card"
    >
      {/* alt="" on purpose: the pseudo sits right next to it in the page, so a name here
          would simply be read twice. */}
      <Avatar src={previewUrl ?? user.avatarUrl} fallback={initials} className="size-40 shrink-0" />

      <div className="flex flex-col gap-2">
        {/* The real input stays in the DOM but hidden, and a <button> triggers it via
            .click(): a bare hidden file input is not reachable with Tab/Enter. */}
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT_ATTRIBUTE}
          className="hidden"
          disabled={busy}
          onChange={handleFileChange}
        />

        {pickedFile ? (
          <>
            <p className="text-sm text-text-secondary">Preview — confirm upload?</p>
            <div className="flex gap-2">
              <Button onClick={handleConfirm} disabled={busy}>
                {busy ? 'Uploading…' : 'Confirm'}
              </Button>
              <Button variant="secondary" onClick={() => setPickedFile(null)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
              {user.avatarUrl ? 'Change' : 'Add'}
            </Button>
            {user.avatarUrl ? (
              <Button variant="danger" onClick={() => setConfirmingRemoval(true)} disabled={busy}>
                Remove
              </Button>
            ) : null}
          </div>
        )}

        {progress === null ? null : <ProgressBar value={progress} label="Uploading avatar" />}

        {error ? <FormMessage>{error}</FormMessage> : null}
      </div>

      {/* Removal is irreversible — the MinIO object is destroyed — and the button sits a few
          pixels from the one that merely picks a new image. */}
      <ConfirmDialog
        open={confirmingRemoval}
        title="Remove your avatar?"
        description="Your profile image will fall back to your initials."
        confirmLabel="Remove"
        pending={busy}
        error={confirmingRemoval ? error : null}
        onConfirm={handleRemove}
        onCancel={() => {
          setConfirmingRemoval(false);
          setError(null);
        }}
        returnFocusRef={blockRef}
      />
    </div>
  );
}
