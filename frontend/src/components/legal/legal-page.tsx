import { SectionTitle } from '@/components/ui/section-title';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteLogo } from '@/components/layout/SiteLogo';

import type { ReactNode } from 'react';

/**
 * Shell of the two legal pages, /terms and /privacy.
 *
 * these are PUBLIC — reachable without a session from the landing footer and the sign-in /
 * sign-up screens. so they mount neither the rail nor AuthenticatedLayout, and they must never
 * call the API. the only way out is the wordmark (SiteLogo already points at the right home).
 * the table of contents is plain <a href="#..."> and not router <Link>s: a hash in the current
 * page is a scroll, not a navigation, and a <Link> would push a history entry that makes Back
 * walk up the document.
 */
type LegalPageProps = {
  title: string;
  /** Human date, e.g. "1 August 2026" — the same string is read by the audit scenario. */
  updatedAt: string;
  /** Standfirst under the title: what this document is, in two or three sentences. */
  intro: ReactNode;
  /** Table of contents, in document order: the `id` of each `<LegalSection>` and its title. */
  contents: ReadonlyArray<{ id: string; title: string }>;
  children: ReactNode;
};

export function LegalPage({ title, updatedAt, intro, contents, children }: LegalPageProps) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 px-4 py-6 sm:px-8">
      <header>
        <SiteLogo className="text-2xl" />
      </header>

      <main className="flex-1 space-y-10">
        <div className="space-y-4">
          <p className="text-xs label-caps text-text-muted">Last updated {updatedAt}</p>
          <h1 className="text-3xl label-caps-black">{title}</h1>
          <div className="space-y-3 text-sm leading-6 text-text-secondary">{intro}</div>
        </div>

        <nav aria-label="On this page" className="space-y-3">
          <SectionTitle>Contents</SectionTitle>
          <ol className="grid gap-x-6 gap-y-1 text-sm text-text-secondary sm:grid-cols-2">
            {contents.map((entry, index) => (
              <li key={entry.id} className="flex gap-2">
                <span aria-hidden="true" className="text-text-muted">
                  {index + 1}.
                </span>
                <a
                  href={`#${entry.id}`}
                  className="rounded-control transition hover:text-text-primary focus-ring focus-visible:outline-offset-4"
                >
                  {entry.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {children}
      </main>

      <SiteFooter />
    </div>
  );
}

type LegalSectionProps = {
  /** Anchor target of the table of contents. Must match its `contents` entry. */
  id: string;
  title: string;
  children: ReactNode;
};

// One numbered clause. `scroll-mt-6` keeps the heading off the very top edge when the table of
// contents jumps to it.
export function LegalSection({ id, title, children }: LegalSectionProps) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <SectionTitle>{title}</SectionTitle>
      <div className="space-y-3 text-sm leading-6 text-text-secondary">{children}</div>
    </section>
  );
}

// Bullet list of a clause. Kept here rather than in `ui/`: it is the list style of a legal
// document, not a component of the product.
export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="ml-5 list-disc space-y-2 marker:text-text-muted">{children}</ul>;
}

// The four maintainers, in one place: both documents name them, and a stale address on a legal
// page is worse than no address at all.
const MAINTAINERS = [
  'dpinto@student.42.fr',
  'wacista@student.42.fr',
  'wiwu@student.42.fr',
  'acattet@student.42.fr',
] as const;

export function MaintainerList() {
  return (
    <ul className="space-y-1">
      {MAINTAINERS.map((address) => (
        <li key={address}>
          <a
            href={`mailto:${address}`}
            className="rounded-control text-text-primary underline underline-offset-4 transition hover:text-text-primary focus-ring focus-visible:outline-offset-4"
          >
            {address}
          </a>
        </li>
      ))}
    </ul>
  );
}
