import { useId } from 'react';

import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

import type { HistoryFilterState, MatchFormat } from '@/lib/history';

type HistoryFiltersProps = {
  filters: HistoryFilterState;
  /** Every option is DERIVED from the matches on screen — see `lib/history.ts`. */
  games: { id: string; name: string }[];
  formats: MatchFormat[];
  results: ('win' | 'loss')[];
  onChange: (filters: HistoryFilterState) => void;
};

const resultLabels: Record<'win' | 'loss', string> = { win: 'Wins', loss: 'Losses' };

/**
 * The four filters of `/history`: game, format, result, and "still in play".
 *
 * 🚨 EVERY OPTION COMES FROM THE MATCHES, NEVER FROM THE CONTRACT'S ENUMS. That is the [F-MM]
 * lesson, and this screen has no excuse for repeating it: the whole history is already in
 * memory, so a select can only ever offer a value that matches at least one row. Nobody can
 * land on an empty table and be left wondering whether he never played that combination or
 * whether the page is broken.
 *
 * 🔑 FILTERING NEVER TOUCHES THE NETWORK. `GET /matches/me` returns everything in one call —
 * `?ladderId=` exists but is deliberately not used here (see `useMyMatchHistory`). Changing a
 * select is a `filter()` over an array, so it applies instantly and an "Apply" button would
 * be a form nobody submits.
 *
 * Native `<select>`s and a native checkbox, same reasoning as `SlotFilters`: the platform
 * brings keyboard behaviour, type-ahead and the OS wheel picker on a phone for free.
 */
export function HistoryFilters({
  filters,
  games,
  formats,
  results,
  onChange,
}: HistoryFiltersProps) {
  const gameFieldId = useId();
  const formatFieldId = useId();
  const resultFieldId = useId();

  return (
    <fieldset className="flex flex-wrap items-end gap-4 border-0 p-0">
      {/* Names the group for a screen reader without adding a heading: the four controls
          would otherwise be four loose fields hanging under the section title. */}
      <legend className="sr-only">Filter your match history</legend>

      <div className="flex min-w-40 flex-1 flex-col gap-2 sm:max-w-56">
        <Label htmlFor={gameFieldId}>Game</Label>
        <Select
          id={gameFieldId}
          value={filters.gameId ?? ''}
          onChange={(event) => {
            const gameId = event.target.value || undefined;
            // ⚠️ A format the NEW game does not have is DROPPED, never kept out of sight:
            // leaving "1v1" set while switching to a game that has no 1v1 ladder would empty
            // the table while the Format select still displayed a value it no longer offers.
            onChange({ ...filters, gameId, format: undefined });
          }}
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
          value={filters.format ?? ''}
          // Matched AGAINST the options we rendered rather than cast: `event.target.value` is
          // a plain string, and asserting it into a closed union is how a value nobody offers
          // ends up in the state.
          onChange={(event) =>
            onChange({
              ...filters,
              format: formats.find((value) => value === event.target.value),
            })
          }
        >
          <option value="">All formats</option>
          {formats.map((format) => (
            <option key={format} value={format}>
              {format}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex min-w-32 flex-1 flex-col gap-2 sm:max-w-40">
        <Label htmlFor={resultFieldId}>Result</Label>
        <Select
          id={resultFieldId}
          value={filters.result ?? ''}
          onChange={(event) =>
            onChange({
              ...filters,
              result: results.find((value) => value === event.target.value),
            })
          }
        >
          <option value="">All results</option>
          {results.map((result) => (
            <option key={result} value={result}>
              {resultLabels[result]}
            </option>
          ))}
        </Select>
      </div>

      {/* A real <label> wrapping a real checkbox: the whole sentence is the click target and
          the accessible name, with no ARIA and no JS. */}
      <label className="flex min-h-12 cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          className="focus-ring size-4 shrink-0 accent-action-primary"
          checked={filters.ongoingOnly}
          onChange={(event) => onChange({ ...filters, ongoingOnly: event.target.checked })}
        />
        <span className="text-sm text-text-secondary">Still in play</span>
      </label>
    </fieldset>
  );
}
