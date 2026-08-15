import type { ReactNode } from 'react';

type ErrorPanelProps = {
  /** Rendered as the page's `<h1>`: this panel REPLACES the page it stands in for. */
  title: string;
  message: string;
  /** The way out — a link back to a page that certainly exists. */
  children?: ReactNode;
};

/** Full-page dead end: a malformed id, a 404, an unreachable API. */
export function ErrorPanel({ title, message, children }: ErrorPanelProps) {
  return (
    <div className="panel flex flex-col items-start gap-4 p-6">
      <h1 className="text-2xl label-caps-black">{title}</h1>
      <p className="max-w-prose text-sm text-text-secondary">{message}</p>
      {children}
    </div>
  );
}
