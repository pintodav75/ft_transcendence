import { CircleAlert } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';

import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-variants';
import { formatProviderList } from '@/lib/home';
import { providerLabel } from '@/lib/games';

import type { RequiredProvider } from '@/lib/games';

type LinkAccountBannerProps = {
  /**
   * The providers required by this platform that I have NOT linked — never empty and never
   * unknown: the page renders nothing at all in those two cases (see `missingProviders`, whose
   * `undefined` means "we do not know", not "nothing is missing").
   */
  providers: RequiredProvider[];
  /** Closes the reminder FOR GOOD, per account. */
  onDismiss: () => void;
};

/** The §5.1 reminder: no linked game account, no match. */
export function LinkAccountBanner({ providers, onDismiss }: LinkAccountBannerProps) {
  const titleId = useId();
  const names = providers.map(providerLabel);
  const plural = names.length > 1;

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-card border border-arena-red/60 bg-arena-red-soft/50 px-5 py-4 shadow-card"
    >
      <h2 id={titleId} className="flex items-center gap-2 text-base font-bold text-text-primary">
        <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-arena-red" />
        Link your game accounts
      </h2>

      <p className="mt-2 max-w-prose text-sm text-text-secondary">
        <strong className="text-text-primary">{formatProviderList(names)}</strong>{' '}
        {plural ? 'are not linked yet' : 'is not linked yet'}. The platform tracks games played
        elsewhere, so it has to know who you are there: a slot cannot be opened or accepted with
        an unlinked player in the line-up.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">

        <Link to="/profile" className={buttonClasses('primary')}>
          Link an account
        </Link>
        <Button variant="secondary" onClick={onDismiss}>
          Don’t show this again
        </Button>
      </div>
    </section>
  );
}
