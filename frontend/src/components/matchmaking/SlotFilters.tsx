/**
 * The three filters: game, format, and "only what I can accept" tickbox.
 *
 * Native `<select>`s: the platform brings the keyboard behaviour, the type-ahead
 * and the OS wheel picker on a phone.
 * because nobody wants to have to click an "Apply" button (which is what a form would be).
 */

import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { SLOT_FORMATS } from '@/lib/matchmaking';
import { Select } from '@/components/ui/select';

import type { Game } from '@/lib/games';
import type { SlotFormat } from '@/lib/matchmaking';

type SlotFiltersProps = {
  /** from the cached `GET /games`. Empty while it loads or if it fails. */
  games: Game[];
  gameId: string | undefined;
  format: SlotFormat | undefined;
  formats: readonly SlotFormat[]; // format for that game
  acceptableOnly: boolean;
  onGameChange: (gameId: string | undefined) => void;
  onFormatChange: (format: SlotFormat | undefined) => void;
  onAcceptableOnlyChange: (acceptableOnly: boolean) => void;
};

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
      <legend className="sr-only">Filter the open slots</legend>

      <div className="flex min-w-40 flex-1 flex-col gap-2 sm:max-w-56">
        <Label htmlFor={gameFieldId}>Game</Label>
        <Select
          id={gameFieldId}
          value={gameId ?? ''}
          // The empty value means "no filter", so it is never SENT — `openSlotsSearch` omits a
          // blank parameter rather than posting `?gameId=` (see `lib/matchmaking.ts`).
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
          // if you pick 2v2: event.target.value is the string '2v2'. .find walks the four
          // entries of SLOT_FORMATS and returns the one that's === to it — the tuple's own
          // '2v2'.
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
