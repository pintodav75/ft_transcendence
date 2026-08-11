import { User } from 'lucide-react';

import { SoloLadderCards } from '@/components/solo/SoloLadderCards';

/**
 * `/solo` — the mirror of /teams: pick the ladder you want to play on.
 *
 * you don't JOIN a solo ladder: a rankings row is created by the first match RESULT, never by
 * an enrolment. so this can't list "my solo ladders" — it lists the 1v1 ladders that exist and
 * hangs my standing off the ones I've played. listing only ranked ones gives a new account an
 * empty page with no way in.
 * hence no invitations block, no game filter, no create button — ladders are seeded by a migration.
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
