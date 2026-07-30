import { useId } from 'react';

import { Label } from '@/components/ui/label';
import { SLOT_FORMATS } from '@/lib/matchmaking';
import { Select } from '@/components/ui/select';

import type { Game } from '@/lib/games';
import type { SlotFormat } from '@/lib/matchmaking';

type SlotFiltersProps = {
  /** Display-sorted games, from the cached `GET /games`. Empty while it loads or if it fails. */
  games: Game[];
  gameId: string | undefined;
  format: SlotFormat | undefined;
  /**
   * The formats that actually EXIST for the selected game — not the four the contract knows.
   * Valorant has no 1v1 ladder, so offering "1v1" there is offering an empty board, and the
   * reader is left to guess whether nobody is playing or the combination cannot exist.
   */
  formats: readonly SlotFormat[];
  acceptableOnly: boolean;
  onGameChange: (gameId: string | undefined) => void;
  onFormatChange: (format: SlotFormat | undefined) => void;
  onAcceptableOnlyChange: (acceptableOnly: boolean) => void;
};

/**
 * The three filters of the board: game, format, and "only what I can accept".
 *
 * 🚨 THE BOX IS TICKED BY DEFAULT, AND IT IS UNTICKABLE. Ticked, the board answers "what can I
 * play tonight?"; unticked, it answers "why can I not play?" — which is the whole point of
 * showing a refused slot with its reason instead of hiding it. Two questions, one screen.
 *
 * ⚠️ NO "my ladders" filter, ever: in 1v1 there is no such thing as being enrolled (a
 * `rankings` row is born of the first RESULT), so that filter would greet a new account with
 * an empty page and no way in — the very asymmetry [F-SOLO] is built around.
 *
 * Native `<select>`s, deliberately: the platform brings the keyboard behaviour, the type-ahead
 * and the OS wheel picker on a phone. Changing one applies immediately — a filter bar with an
 * "Apply" button is a form nobody submits.
 */
export function SlotFilters({
  games,
  gameId,
  format,
  formats,
  acceptableOnly,
  onGameChange,
  onFormatChange,
  onAcceptableOnlyChange,
}: SlotFiltersProps) {
  const gameFieldId = useId();
  const formatFieldId = useId();

  return (
    <fieldset className="flex flex-wrap items-end gap-4 border-0 p-0">
      {/* The group is named for a screen reader without adding a heading to the page: the
          three controls below are otherwise three loose fields under an <h1>. */}
      <legend className="sr-only">Filter the open slots</legend>

      <div className="flex min-w-40 flex-1 flex-col gap-2 sm:max-w-56">
        <Label htmlFor={gameFieldId}>Game</Label>
        <Select
          id={gameFieldId}
          value={gameId ?? ''}
          // The empty value means "no filter", so it is never SENT — `openSlotsSearch` omits
          // a blank parameter rather than posting `?gameId=` (see `lib/matchmaking.ts`).
          onChange={(event) => onGameChange(event.target.value || undefined)}
        >
          <option value="">All games</option>
          {games.map((game) => (
            <option key={game.id} value={game.id}>
              {game.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex min-w-32 flex-1 flex-col gap-2 sm:max-w-40">
        <Label htmlFor={formatFieldId}>Format</Label>
        <Select
          id={formatFieldId}
          value={format ?? ''}
          // Matched AGAINST the contract's enum instead of cast: `event.target.value` is a
          // plain string, and asserting it into a closed union is exactly how an unlisted
          // value reaches the API and comes back as a 400.
          onChange={(event) =>
            onFormatChange(SLOT_FORMATS.find((value) => value === event.target.value))
          }
        >
          <option value="">All formats</option>
          {formats.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      </div>

      {/* A real <label> wrapping a real checkbox: the whole sentence becomes the click target
          and the accessible name, with no ARIA and no JS. */}
      <label className="flex min-h-12 cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          className="focus-ring size-4 shrink-0 accent-action-primary"
          checked={acceptableOnly}
          onChange={(event) => onAcceptableOnlyChange(event.target.checked)}
        />
        <span className="text-sm text-text-secondary">Only slots I can accept</span>
      </label>
    </fieldset>
  );
}
