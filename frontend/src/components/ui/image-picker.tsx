import { ImagePlus, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { FormMessage } from '@/components/ui/form-message';
import { ProgressBar } from '@/components/ui/progress-bar';
import { IMAGE_ACCEPT_ATTRIBUTE, imageFileError } from '@/lib/image-file';
import { cn } from '@/lib/utils';

// The accepted types, the 2 MB cap and the two refusal sentences used to be declared right here.

type ImagePickerProps = {
  // Controlled like a native <input>: no "selected file" state lives in here.
  value: File | null;
  onChange: (file: File | null) => void;
  // Set by the parent while an upload started elsewhere (see TeamCreation, which only uploads
  // after the team itself exists) is in flight.
  progress?: number | null;
  disabled?: boolean;
  // Accessible name for the picker ("Team logo") — also used in the button's aria-label and the
  // empty/removed state.
  label: string;
  className?: string;
};

// The three front bullets of the File upload module live here: a button that opens the native
// file picker, client-side MIME/size validation with a readable message, a local preview, a
// progress bar, and a way to remove the current pick — all in one reusable, controlled
// component.
export function ImagePicker({
  value,
  onChange,
  progress = null,
  disabled = false,
  label,
  className,
}: ImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [validationError, setValidationError] = useState<string | null>(null);

  // Derived from `value`, computed at render rather than mirrored into state via an effect
  // (react-hooks/set-state-in-effect).
  const previewUrl = useMemo(() => (value ? URL.createObjectURL(value) : null), [value]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const isUploading = typeof progress === 'number';
  const isDisabled = disabled || isUploading;

  function handleFileSelected(fileList: FileList | null) {
    const file = fileList?.[0];

    // Reset the raw input value regardless of outcome: without this, picking the exact same
    // (invalid) file twice in a row doesn't fire `onChange` the second time, so a fixed re-pick
    // of the same path would silently do nothing.
    if (inputRef.current) inputRef.current.value = '';

    if (!file) return;

    const refusal = imageFileError(file);
    if (refusal) {
      setValidationError(refusal);
      return;
    }

    setValidationError(null);
    onChange(file);
  }

  function handleRemove() {
    setValidationError(null);
    onChange(null);
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center gap-3">

        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={IMAGE_ACCEPT_ATTRIBUTE}
          className="hidden"
          disabled={isDisabled}
          onChange={(event) => handleFileSelected(event.target.files)}
        />

        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            className="size-14 shrink-0 rounded-full border border-border-subtle object-cover"
          />
        ) : null}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isDisabled}
          aria-label={value ? `Change ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}
          className={cn(
            'focus-ring inline-flex size-14 shrink-0 items-center justify-center rounded-full border border-dashed border-border-subtle text-text-secondary transition hover:border-border-strong hover:text-text-primary',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <ImagePlus className="size-5" aria-hidden="true" />
        </button>

        {value ? (
          <button
            type="button"
            onClick={handleRemove}
            disabled={isDisabled}
            className="focus-ring inline-flex items-center gap-1 text-xs text-text-muted transition hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="size-3.5" aria-hidden="true" />
            Remove
          </button>
        ) : null}
      </div>

      {typeof progress === 'number' ? (
        <ProgressBar value={progress} label={`Uploading ${label.toLowerCase()}`} />
      ) : null}

      {validationError ? <FormMessage>{validationError}</FormMessage> : null}
    </div>
  );
}
