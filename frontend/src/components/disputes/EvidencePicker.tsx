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
  /** Ids of the hint and, when there is one, of the failure message written by the form. */
  describedBy?: string;
  /** Marks the visible control invalid — mirrors `aria-invalid` on a text field. */
  invalid?: boolean;
  className?: string;
};

/** Picks the file attached to a piece of evidence: an image OR a PDF, up to 5 MB. */
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
      // The current pick is DROPPED on a refusal, so the submit button cannot stay armed on a
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
        // invalid state — see `describedBy`.
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

      {validationError ? (
        <FormMessage id={validationErrorId}>{validationError}</FormMessage>
      ) : null}
    </div>
  );
}
