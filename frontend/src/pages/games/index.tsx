import { Gamepad2 } from 'lucide-react';

import { GamesGrid } from '@/components/games/GamesGrid';

/**
 * `/games` — the entrance to everything competitive: pick a game, then a ladder on it.
 *
 * 🔑 WHY THIS PAGE EXISTS AT ALL. [FT-3] deleted `/ranking` and left `/games` a stub, so an
 * account with no team had NO clickable path to a standings board — the ladders existed and
 * nothing linked to them. This grid, then `/games/$gameId`, then `/ladders/$ladderId` is that
 * path.
 *
 * Same layout as `/teams` and `/solo`: a panel, a header, and a self-contained grid.
 */
export function Games() {
  return (
    <div className="panel flex flex-col gap-4 p-6">
      <header className="space-y-1">
        <p className="flex items-center gap-2 text-xs label-caps text-success">
          <Gamepad2 aria-hidden="true" className="size-4" /> Games
        </p>
        <h1 className="text-3xl label-caps-black">Pick a game</h1>
        <p className="max-w-prose pt-1 text-sm text-text-secondary">
          Every game on the platform, with the formats you can be ranked in. Open one to see its
          ladders, who is on top of them, and how to enter — on your own name or with a squad.
        </p>
      </header>

      {/* Owns its own requests and all three states — the page stays a layout. */}
      <GamesGrid />
    </div>
  );
}
