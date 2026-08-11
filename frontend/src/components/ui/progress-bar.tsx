import { cn } from '@/lib/utils';

type ProgressBarProps = {
  /** 0-100. Comes from XHR's `upload.onprogress` — `fetch` has no such event. */
  value: number;
  /** Accessible name of the bar ("Uploading team logo"). */
  label: string;
  className?: string;
};

/** Determinate progress bar of an upload. */
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
