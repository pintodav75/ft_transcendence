import { useEffect, useId, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';

import type { FormEvent, MouseEvent, ReactNode, RefObject } from 'react';

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
  /** Where to send focus when the element that OPENED the dialog no longer exists. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Controls the confirmation itself requires (a password, a TOTP code), rendered under the
   * description.
   */
  children?: ReactNode;
  /** Focused on open in place of Cancel — the first field of `children`, typically. */
  initialFocusRef?: RefObject<HTMLElement | null>;
};

/** Confirmation modal built on the native `<dialog>` driven by `showModal()`. */
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
  returnFocusRef,
  children,
  initialFocusRef,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // L'élément qui a ouvert la boîte, retenu à l'ouverture (cf. l'effet ci-dessous).
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      // showModal() throws InvalidStateError on an already-open dialog.
      if (!dialog.open) {
        // Retenu AVANT showModal(), pendant que l'élément déclencheur a encore le focus : c'est
        // la seule façon de savoir, à la fermeture, s'il existe toujours.
        openerRef.current = document.activeElement as HTMLElement | null;
        dialog.showModal();
        // The browser would otherwise focus the first tabbable child. Landing on the
        // DESTRUCTIVE button means a stray Enter kicks a player; Cancel is the safe default.
        (initialFocusRef?.current ?? cancelRef.current)?.focus();
      }
      return;
    }

    // Skipping this would leave the dialog in the top layer — above everything, and invisible
    // to React, which already believes it is closed.
    if (!dialog.open) return;
    dialog.close();

    // On teste si l'élément déclencheur EXISTE ENCORE, et surtout PAS où le focus a atterri.
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener && opener.isConnected) return; // la plateforme a de quoi restaurer : on la laisse
    returnFocusRef?.current?.focus();
  }, [open, returnFocusRef, initialFocusRef]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // `cancel` is what Escape fires.
    function handleCancel(event: Event) {
      if (pending) {
        // Default action of `cancel` is to close. A mutation is in flight: closing now would
        // strand the user with no idea whether it succeeded.
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
    // A press on the backdrop targets the <dialog> ITSELF; anything inside is swallowed by a
    // child (the dialog carries no padding of its own, the inner wrapper does), so target
    // identity is the whole test.
    if (event.target !== dialogRef.current) return;
    if (pending) return;

    onCancel();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // NOT `method="dialog"`: the platform would close the box on submit, while the whole point
    // of a form here is a mutation that can FAIL and render its error inside.
    event.preventDefault();
    if (pending) return;

    onConfirm();
  }

  const body = (
    <div className="flex flex-col gap-4 p-6">
      <h2 id={titleId} className="label-caps-black text-lg">
        {title}
      </h2>

      <div id={descriptionId} className="text-sm text-text-secondary">
        {description}
      </div>

      {children}

      {error ? <FormMessage>{error}</FormMessage> : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button ref={cancelRef} variant="secondary" disabled={pending} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          variant={tone}
          type={children ? 'submit' : 'button'}
          disabled={pending}
          onClick={children ? undefined : onConfirm}
        >
          {pending ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </div>
  );

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onMouseDown={handleBackdropPress}
      // `m-auto` is not decoration: Tailwind's preflight resets the UA's `margin: auto` on
      // every element, which would pin the dialog to the top-left of the top layer.
      className="m-auto w-[calc(100vw-2rem)] max-w-md rounded-card border border-border-subtle bg-surface-card p-0 text-text-primary shadow-card backdrop:bg-scrim"
    >
      {children ? <form onSubmit={handleSubmit}>{body}</form> : body}
    </dialog>
  );
}
