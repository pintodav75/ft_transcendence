import { Link } from '@tanstack/react-router';
import { Swords } from 'lucide-react';

import { Callout } from '@/components/ui/callout';
import { useOpenSlots } from '@/lib/matchmaking';

type LadderOpenSlotsProps = {
  ladderId: string;
  /** Only used in prose, so the sentence names the ladder the reader is already looking at. */
  ladderName: string;
};

/**
 * "Someone is looking for a game here" — the doorway from a ladder to `/matchmaking`.
 *
 * 🔑 WHY THIS EXISTS. [F-MM] taught `/matchmaking` to read `?ladderId=`, but left every producer
 * of that link out of scope: the filter worked and was reachable only by typing the URL by hand.
 * A ladder is exactly where the question "is anyone playing here tonight?" is asked, so that is
 * where the answer belongs.
 *
 * ⚠️ IT COSTS ONE REQUEST, and the count is the whole point. A bare link would be cheaper but it
 * would lead to an empty board as often as not, and the reader would have no way to know before
 * clicking. The same call yields BOTH numbers — how many slots are open, and how many this
 * account could actually take — so the sentence never over-promises.
 *
 * ⚠️ `acceptableOnly: false` on purpose: the claim made here is "open slots on this ladder", not
 * "slots for you". The cache key therefore differs from the one `/matchmaking` builds on arrival
 * (its checkbox starts on `true`), so this does NOT pre-warm the board — accepted, because a
 * number that quietly meant something else would be worse than one extra request.
 */
export function LadderOpenSlots({ ladderId, ladderName }: LadderOpenSlotsProps) {
  const { data, isPending, isError } = useOpenSlots({ ladderId, acceptableOnly: false });

  // Silent while loading, and silent on failure. This block is an INVITATION on someone else's
  // page: a spinner would shift the layout of a ladder sheet for a secondary claim, and an error
  // box would report a problem the reader can do nothing about, on a page that is otherwise fine.
  if (isPending || isError || !data) return null;

  const slots = data.slots;
  const mine = slots.filter((slot) => slot.canAccept).length;

  if (slots.length === 0) {
    return (
      // ⚠️ « FROM ANOTHER CAMP » N'EST PAS UN ORNEMENT. `GET /matches` excludes the reader's OWN
      // slots, so on a page that also shows "your next match — waiting for an opponent" (the solo
      // sheet, the team sheet) a flat "no open slot" contradicts the block right below it. Seen
      // on a screenshot, never by a check: both sentences are true in isolation.
      <Callout tone="muted">
        No slot from another camp is open on {ladderName} right now — the ones you opened are not
        listed here.
      </Callout>
    );
  }

  return (
    <Callout tone="muted">
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <Swords aria-hidden="true" className="size-4 shrink-0" />
        <span>
          {/* ⚠️ The sentence says "slots are open", the link says "open slots" — say it TWICE and
              the box reads as filler. Naming the second number matters more than the first: "3
              open slots" is an invitation even when every one of them is out of reach. */}
          <strong className="text-text-primary">{slots.length}</strong>{' '}
          {slots.length === 1 ? 'slot is' : 'slots are'} open here
          {mine > 0 ? `, ${mine} you can accept` : ' — none you can accept yet'}.
        </span>
        <Link to="/matchmaking" search={{ ladderId }} className="underline underline-offset-2">
          See open slots
        </Link>
      </span>
    </Callout>
  );
}
