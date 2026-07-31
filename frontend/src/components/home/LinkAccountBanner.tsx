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

/**
 * The §5.1 reminder: no linked game account, no match.
 *
 * 🚨 THE COPY WAS REWRITTEN FROM SCRATCH AND MUST NOT DRIFT BACK. The first version of this
 * component (written long before the product decision was documented, and never mounted by
 * anything) said « you cannot enter the **queue** » and « start **matchmatching** ». **There is
 * no queue in this product** — the model is challenge/accept: a camp opens a slot, another
 * takes it, and no screen may ever suggest otherwise. The second was a typo. Only the red
 * surface of that version survives.
 *
 * 🔑 WHY THIS IS WORTH THE TOP OF THE PAGE. `validateSide()` refuses a side in **400** when a
 * player has no `user_external_accounts` row for the game's `requiredProvider`. Without a linked
 * account a real user cannot open a slot, cannot be fielded in one, and therefore cannot use the
 * central feature of the platform at all — while nothing on screen explains why.
 *
 * ⚠️ DATA-DRIVEN, NEVER A HARD-CODED LIST OF PROVIDERS: the names come from
 * `games.required_provider` through `providerLabel`, which is typed on the codegen union — so
 * the day a provider is added, this breaks at COMPILE TIME instead of rendering `undefined`.
 *
 * ⚠️ « Don't show this again », NOT a « × ». A cross reads as "hide it for now", and the choice
 * here is permanent: someone who clicked it would never be warned again without ever having
 * meant that. The words make the consequence explicit; the icon would hide it.
 */
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

      {/* `flex-wrap`: at 375 px the two targets stack instead of shrinking below the 24 px
          WCAG 2.5.8 asks for. */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {/* 🚨 THE LINK STAYS, AND IT IS A DELIBERATE ARBITRATION — not an oversight, so do not
            "fix" it. `/profile` renders a placeholder today ([F4] ships the settings page), so
            this button leads somewhere that cannot yet do what it promises.

            ⚠️ IT THEREFORE DISAGREES WITH `lib/matchmaking.ts` ON PURPOSE. There, the
            `account_not_linked` refusal deliberately carries NO link ("a button leading nowhere
            is worse than a sentence that stops"). The difference is who is reading: that one is
            a refusal printed on a row the user is being denied, where a dead end adds insult;
            this one is a reminder whose ONLY job is to point at the place where the linking will
            live. David's call (review of [F-HOME]): the settings page arrives with the next
            ticket, and a link that becomes useful on its own beats coming back to touch `/home`
            a second time.

            The route exists, so this is never a 404 — i.e. never a red line in the console. */}
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
