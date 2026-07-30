import { User } from 'lucide-react';

import { SoloLadderCards } from '@/components/solo/SoloLadderCards';

/**
 * `/solo` — the mirror of `/teams`: pick the ladder you want to play on.
 *
 * 🚨 THE ONE THING THAT MAKES IT DIFFERENT FROM `/teams`, and it drives the whole page: there
 * is NO SUCH THING AS JOINING a solo ladder. A `rankings` row is created by the first match
 * RESULT, never by an enrolment. So this page cannot list "my solo ladders" — it lists the
 * 1v1 ladders that EXIST and hangs my standing off the ones I have played. Listing only the
 * ranked ones would hand a new account an empty page with no way in, which is exactly the
 * trap the card warned about.
 *
 * Consequently there is no invitations block, no game filter (two tiles) and no "create"
 * button: a ladder is seeded by a migration, nobody creates one.
 */
export function Solo() {
  return (
    <div className="panel flex flex-col gap-4 p-6">
      <header className="space-y-1">
        <p className="flex items-center gap-2 text-xs label-caps text-success">
          <User aria-hidden="true" className="size-4" /> Solo
        </p>
        <h1 className="text-3xl label-caps-black">1v1 ladders</h1>
        <p className="max-w-prose pt-1 text-sm text-text-secondary">
          Play on your own name: open a slot, wait for someone to take it, then both sides
          report the score. Your Elo on a ladder starts the day you finish your first match on
          it.
        </p>
      </header>

      {/* Owns its own requests and all three states — the page stays a layout. */}
      <SoloLadderCards />
    </div>
  );
}
