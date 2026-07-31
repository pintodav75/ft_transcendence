import { Link } from '@tanstack/react-router';

import { OpenSlotRow } from '@/components/matchmaking/OpenSlotRow';
import { SectionTitle } from '@/components/ui/section-title';
import { sectionLinkClasses } from '@/components/ui/link-variants';

import type { OpenSlot } from '@/lib/matchmaking';

type OpenSlotsTeaserProps = {
  /** Already filtered to what this account can accept AND is still in time for — empty renders nothing. */
  slots: OpenSlot[];
};

/**
 * « Slots you can take tonight » — a three-row teaser of the matchmaking board.
 *
 * 🚨 NO OPPONENT, NO CREATOR, NO MAPS, EVER. Slot anonymity is a product decision (B5b), not a
 * gap in the payload: a slot is accepted WITHOUT knowing who opened it, which is what stops
 * opponent-shopping and protects the Elo. `OpenSlotRow` is reused precisely because it already
 * enforces that — a row here says game, format, ladder and kick-off, and nothing may ever be
 * added to that list.
 *
 * 🚨 NO ACCEPT BUTTON HERE EITHER, and that is what makes the block safe. Accepting is a
 * two-shape flow (a line-up panel from 2v2 up, a confirmation dialog in 1v1) with its own focus
 * management and its own 409 handling; half of it on a summary page would be a button the API
 * could refuse, i.e. a red line in the Chrome console — a project-rejection criterion. The row
 * is served with `refusal={null} action={null}`, which is exactly the read-only shape it
 * already supports.
 *
 * 🔑 The list only ever holds ACCEPTABLE slots (`?acceptable=true`), so there is no verdict to
 * phrase: every row here is one the reader can actually take on `/matchmaking`.
 */
export function OpenSlotsTeaser({ slots }: OpenSlotsTeaserProps) {
  if (slots.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <SectionTitle
        action={
          <Link to="/matchmaking" className={sectionLinkClasses()}>
            See the whole board
          </Link>
        }
      >
        Slots you can take
      </SectionTitle>

      {/* Named so a screen reader hears WHICH list this is, and so a selector can target it
          rather than any `<ul>` of the page. `role="list"` is explicit: Safari drops the list
          role from a `<ul>` whose display is not `list-item`. */}
      <ul role="list" aria-label="Open slots you can accept" className="flex min-w-0 flex-col gap-3">
        {slots.map((slot) => (
          <OpenSlotRow key={slot.id} slot={slot} refusal={null} action={null} />
        ))}
      </ul>
    </div>
  );
}
