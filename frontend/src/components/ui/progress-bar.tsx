import { cn } from '@/lib/utils';

type ProgressBarProps = {
  /** 0-100. Comes from XHR's `upload.onprogress` — `fetch` has no such event. */
  value: number;
  /**
   * Accessible name of the bar ("Uploading team logo"). Required: a `progressbar` with no name
   * is announced as a bare percentage, which says nothing about WHAT is progressing on a page
   * that can hold more than one.
   */
  label: string;
  className?: string;
};

/**
 * Determinate progress bar of an upload.
 *
 * Extracted from `ui/image-picker.tsx` at its SECOND use ([F-DISPUTE], whose evidence picker
 * needs the same bar for a file that may be a PDF): a generic control with no knowledge of the
 * domain belongs in `components/ui` — and the alternative was copying its class string, which the
 * repo's reuse rule forbids.
 *
 * ⚠️ The rendered DOM is IDENTICAL to what `ImagePicker` shipped, attributes included:
 * `teams-manage` watches `[role="progressbar"]` while a logo uploads.
 */
export function ProgressBar({ value, label, className }: ProgressBarProps) {
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-border-subtle', className)}
    >
      <div
        className="h-full rounded-full bg-action-primary transition-[width]"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}
