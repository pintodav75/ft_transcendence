import { CircleAlert, CircleCheck, CircleHelp } from 'lucide-react';

import { Callout } from '@/components/ui/callout';
import { SectionTitle } from '@/components/ui/section-title';
import { providerLabel } from '@/lib/games';

import type { RequiredProvider } from '@/lib/games';

type LinkedAccountStatusProps = {
  provider: RequiredProvider;
  gameName: string;
  /**
   * THREE-VALUED, and the third value is the point: `undefined` = we do not know yet (the
   * request is in flight or it failed), which is NOT "not linked".
   */
  linked: boolean | undefined;
  /** Distinguishes "still loading" from "the request failed" — they read differently. */
  isError: boolean;
};

/**
 * Where a team page shows its roster, a solo page shows THE state that gates everything:
 * whether my in-game account for this game is linked.
 */
export function LinkedAccountStatus({
  provider,
  gameName,
  linked,
  isError,
}: LinkedAccountStatusProps) {
  const name = providerLabel(provider);

  return (
    <section className="flex flex-col gap-3.5">
      <SectionTitle>Game account</SectionTitle>

      {linked === true && (
        <p className="flex items-center gap-2 text-sm text-success">
          <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
          Your {name} account is linked — you can open slots on this ladder.
        </p>
      )}

      {linked === false && (
        <Callout tone="danger">
          <span className="flex items-start gap-2">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong className="text-text-primary">No {name} account linked.</strong> {gameName}{' '}
              needs one before you can open a slot here: the platform tracks matches played on{' '}
              {name}, so it has to know who you are there. Link it from your account settings,
              then come back — the button appears on its own.
            </span>
          </span>
        </Callout>
      )}

      {linked === undefined && (
        <Callout tone="muted">
          <span className="flex items-start gap-2">
            <CircleHelp aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              {isError
                ? `Your linked accounts could not be loaded, so we cannot tell whether your ${name} account is ready. Reload the page to try again.`
                : 'Checking your linked accounts…'}{' '}
              Opening a slot stays unavailable until we know — the server would refuse it
              without a linked account.
            </span>
          </span>
        </Callout>
      )}
    </section>
  );
}
