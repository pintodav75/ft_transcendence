import { FileText, Paperclip, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { FormMessage } from '@/components/ui/form-message';
import { ProgressBar } from '@/components/ui/progress-bar';
import {
  EVIDENCE_ACCEPT_ATTRIBUTE,
  EVIDENCE_MAX_MB,
  evidenceFileError,
  formatFileSize,
} from '@/lib/dispute-detail';
import { cn } from '@/lib/utils';

type EvidencePickerProps = {
  /** Controlled like a native `<input>`: no "selected file" state lives in here. */
  value: File | null;
  onChange: (file: File | null) => void;
  /** `null`/`undefined` = idle, `0-100` = uploading (renders the bar and locks the control). */
  progress?: number | null;
  disabled?: boolean;
  /**
   * Ids of the hint and, when there is one, of the failure message written by the form.
   *
   * ⚠️ THEY LAND ON THE VISIBLE BUTTON, NOT ON THE `<input type="file">`. The input is
   * `display: none`, so it is out of the accessibility tree entirely: a description carried
   * there is announced to nobody, and the "attach a file" requirement was therefore VISIBLE and
   * SILENT at the same time. The button is the control a keyboard or screen-reader user actually
   * reaches, so it is the one that has to carry the description.
   */
  describedBy?: string;
  /** Marks the visible control invalid — mirrors `aria-invalid` on a text field. */
  invalid?: boolean;
  className?: string;
};

/**
 * Picks the file attached to a piece of evidence: an image OR a PDF, up to 5 MB.
 *
 * 🚨 WHY THIS IS NOT `ui/image-picker.tsx` PARAMETERISED — the arbitration, so nobody has to
 * redo it. `ImagePicker` differs on FOUR points at once: the accepted types (it has no PDF), the
 * cap (2 MB against 5), the preview (it always builds one with `URL.createObjectURL`, and a PDF
 * has none), and the SHAPE — a 56 px round button next to a round thumbnail, i.e. an avatar
 * control, which is what it was written for. Making all four pluggable is not sharing a
 * component, it is sharing a name; and it would put the team-logo path — guarded by
 * `ft1c-team-logo` and `teams-manage` — at risk for no gain.
 *
 * 🔑 WHAT IS GENUINELY SHARED IS SHARED. The validation rule lives once in `lib/dispute-detail.ts`
 * (`evidenceFileError`, mirroring the server's `EVIDENCE_MIME`), and the progress bar was
 * EXTRACTED into `ui/progress-bar.tsx` at this second use rather than copied. No class string of
 * `ImagePicker` was reproduced here: this control is a full-width row, not a round button.
 *
 * ⚠️ THE CLIENT CHECK IS AN ECHO, NOT THE RAMPART. The server validates the type and the size
 * again; this exists so a bad pick fails instantly and readably instead of after a round trip
 * that ends in 400/413 — and so no request is spent on a file we already know is refused.
 */
export function EvidencePicker({
  value,
  onChange,
  progress = null,
  disabled = false,
  describedBy,
  invalid = false,
  className,
}: EvidencePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const validationErrorId = useId();
  const [validationError, setValidationError] = useState<string | null>(null);

  /**
   * Local blob preview, IMAGES ONLY — `URL.createObjectURL` happily hands back a url for a PDF,
   * and an `<img>` pointed at it renders a broken glyph.
   *
   * ⚠️ IT DOES **NOT** WRITE A CONSOLE LINE, and this comment used to claim it did. Measured on a
   * deliberately broken build during [F-DISPUTE]: the blob loads fine, only the DECODE fails, and
   * Chrome reports that silently through the element's `error` event. The rule stands, its
   * MOTIVE changed — see `attachmentOf` in `lib/dispute-detail.ts`, which carries it in full.
   *
   * Derived at render rather than mirrored into state through an effect
   * (`react-hooks/set-state-in-effect`); the effect below only does the thing that has no
   * render-time equivalent — revoking the previous url once it is no longer shown.
   */
  const previewUrl = useMemo(
    () => (value && value.type.startsWith('image/') ? URL.createObjectURL(value) : null),
    [value],
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const isUploading = typeof progress === 'number';
  const isDisabled = disabled || isUploading;

  function handleFileSelected(fileList: FileList | null) {
    const file = fileList?.[0];

    // Reset the raw input regardless of the outcome: without this, picking the exact same
    // (invalid) file twice in a row does not fire `onChange` the second time, so a corrected
    // re-pick of the same path would silently do nothing.
    if (inputRef.current) inputRef.current.value = '';

    if (!file) return;

    const error = evidenceFileError(file);
    if (error) {
      setValidationError(error);
      // ⚠️ The current pick is DROPPED on a refusal, so the submit button cannot stay armed on a
      // file the server would reject — that request is exactly the red console line this whole
      // control exists to avoid.
      onChange(null);
      return;
    }

    setValidationError(null);
    onChange(file);
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      {/* The real `<input type="file">` stays in the DOM but hidden: a `<button>` opens it with
          `.click()`, so the control is reachable with Tab/Enter — which a `hidden` file input on
          its own would not be. */}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={EVIDENCE_ACCEPT_ATTRIBUTE}
        className="hidden"
        disabled={isDisabled}
        onChange={(event) => handleFileSelected(event.target.files)}
      />

      {value ? (
        <div className="flex min-w-0 items-center gap-3 rounded-control border border-border-subtle bg-surface-input p-3">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt=""
              className="size-12 shrink-0 rounded-control border border-border-subtle object-cover"
            />
          ) : (
            <FileText aria-hidden="true" className="size-6 shrink-0 text-text-secondary" />
          )}

          <div className="flex min-w-0 flex-col">
            {/* `break-all`: a file name is one unbreakable token and this row is ~290 px at
                375 px — `truncate` would hide the extension, which is the useful half. */}
            <span className="min-w-0 break-all text-xs font-bold text-text-primary">
              {value.name}
            </span>
            <span className="text-xs text-text-muted">{formatFileSize(value.size)}</span>
          </div>

          <button
            type="button"
            onClick={() => {
              setValidationError(null);
              onChange(null);
            }}
            disabled={isDisabled}
            className="focus-ring ms-auto inline-flex shrink-0 items-center gap-1 rounded-control px-1 py-1 text-xs text-text-muted transition hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X aria-hidden="true" className="size-3.5" />
            Remove
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isDisabled}
        // The control that is really in the accessibility tree carries the description AND the
        // invalid state — see `describedBy`. Without this the "attach a file" requirement was
        // rendered on screen and announced to nobody.
        aria-describedby={
          validationError ? [describedBy, validationErrorId].filter(Boolean).join(' ') : describedBy
        }
        aria-invalid={invalid || Boolean(validationError)}
        className="focus-ring inline-flex w-fit items-center gap-2 rounded-control border border-dashed border-border-subtle px-3 py-2 text-xs text-text-secondary transition hover:border-border-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Paperclip aria-hidden="true" className="size-4" />
        {value ? 'Choose another file' : 'Attach a file'}
      </button>

      <p className="text-xs text-text-muted">
        PNG, JPEG, WebP or PDF, up to {EVIDENCE_MAX_MB} MB.
      </p>

      {isUploading ? <ProgressBar value={progress} label="Uploading evidence" /> : null}

      {/* `role="alert"` (carried by `FormMessage`) announces it the moment it appears; the id is
          what also makes it READABLE again later, from the button that owns the description. */}
      {validationError ? (
        <FormMessage id={validationErrorId}>{validationError}</FormMessage>
      ) : null}
    </div>
  );
}
