import { useEffect, useId, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';

import type { MouseEvent, ReactNode } from 'react';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for a destructive action (kick, leave, dissolve), `primary` otherwise. */
  tone?: 'danger' | 'primary';
  /** Mutation in flight: both buttons are disabled AND the dialog refuses to close. */
  pending?: boolean;
  /** Failure message, rendered INSIDE the dialog, which stays open. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Confirmation modal built on the native `<dialog>` driven by `showModal()`.
 *
 * The platform gives us, for free and correctly, everything a hand-rolled modal gets
 * wrong: the focus trap, Escape, inertness of the page behind, and the restoration of
 * focus onto the element that opened it. `showModal()` also promotes the element to the
 * browser's TOP LAYER, so it escapes the 616 px centre column of the app shell without
 * needing a portal.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  pending = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      // showModal() throws InvalidStateError on an already-open dialog.
      if (!dialog.open) {
        dialog.showModal();
        // The browser would otherwise focus the first tabbable child. Landing on the
        // DESTRUCTIVE button means a stray Enter kicks a player; Cancel is the safe default.
        cancelRef.current?.focus();
      }
      return;
    }

    // Skipping this would leave the dialog in the top layer — above everything, and
    // invisible to React, which already believes it is closed.
    if (dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // `cancel` is what Escape fires. It is wired natively rather than through React's
    // onCancel prop because the event does NOT bubble: a native listener behaves the
    // same whatever React does with non-bubbling dialog events.
    function handleCancel(event: Event) {
      if (pending) {
        // Default action of `cancel` is to close. A mutation is in flight: closing now
        // would strand the user with no idea whether it succeeded.
        event.preventDefault();
        return;
      }

      onCancel();
    }

    dialog.addEventListener('cancel', handleCancel);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
    };
  }, [onCancel, pending]);

  function handleBackdropPress(event: MouseEvent<HTMLDialogElement>) {
    // A press on the backdrop targets the <dialog> ITSELF; anything inside is swallowed
    // by a child (the dialog carries no padding of its own, the inner wrapper does), so
    // target identity is the whole test.
    //
    // CHOICE — a backdrop press DISMISSES. This dialog can only ever cancel on that
    // path, never confirm, so a mis-click costs one extra click and nothing more, and it
    // matches what every user expects of a modal. `mousedown` rather than `click` so a
    // selection started inside the box and released outside is not read as a backdrop press.
    if (event.target !== dialogRef.current) return;
    if (pending) return;

    onCancel();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onMouseDown={handleBackdropPress}
      // `m-auto` is not decoration: Tailwind's preflight resets the UA's `margin: auto`
      // on every element, which would pin the dialog to the top-left of the top layer.
      className="m-auto w-[calc(100vw-2rem)] max-w-md rounded-card border border-border-subtle bg-surface-card p-0 text-text-primary shadow-card backdrop:bg-scrim"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id={titleId} className="label-caps-black text-lg">
          {title}
        </h2>

        {/* A <div>, not a <p>: `description` is a ReactNode and callers pass markup
            (a team name in <strong>, a list) — a block element inside a <p> is invalid
            nesting and Chrome says so in the console. */}
        <div id={descriptionId} className="text-sm text-text-secondary">
          {description}
        </div>

        {error ? <FormMessage>{error}</FormMessage> : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} variant="secondary" disabled={pending} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone} disabled={pending} onClick={onConfirm}>
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
