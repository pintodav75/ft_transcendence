// This is a button with only an icon, when you hover it, the LABEL is shown as tooltip.
// This is used in the Right Navigation menu.
// aria-label is for screen readers

import type { ReactNode } from 'react';

export function IconMenuItem({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <div className="group relative flex items-center">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="flex size-11 items-center justify-center rounded-control text-text-secondary focus-ring focus-visible:outline-offset-2"
      >
        {children}
      </button>
      {/* Tooltip, sitting to the left of the button (right-aligned nav). */}
      <span className="pointer-events-none absolute right-full mr-2 whitespace-nowrap rounded-control border border-border-subtle bg-surface-card-strong px-2 py-1 text-xs label-caps text-text-primary opacity-0 shadow-card transition-opacity group-hover:opacity-100">
        {label}
      </span>
    </div>
  );
}
