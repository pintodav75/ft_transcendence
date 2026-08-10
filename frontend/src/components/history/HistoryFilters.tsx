import { useId } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

import type { HistoryFilterState, MatchFormat } from '@/lib/history';

type HistoryFiltersProps = {
  filters: HistoryFilterState;
  /** Every option is DERIVED from the matches on screen — see `lib/history.ts`. */
  games: { id: string; name: string }[];
  formats: MatchFormat[];
  results: ('win' | 'loss')[];
  /**
   * `typed` marks a change that came from the text box, one keystroke at a time — the page
   * uses it to hold its screen-reader announcement until the typing pauses. Every other
   * control is one deliberate act and leaves it `false`.
   */
  onChange: (filters: HistoryFilterState, typed?: boolean) => void;
};

const resultLabels: Record<'win' | 'loss', string> = { win: 'Wins', loss: 'Losses' };

export function HistoryFilters({
  filters,
  games,
  formats,
  results,
  onChange,
}: HistoryFiltersProps) {
  const searchFieldId = useId();
  const gameFieldId = useId();
  const formatFieldId = useId();
  const resultFieldId = useId();

  return (
    <fieldset className="flex flex-wrap items-end gap-4 border-0 p-0">
      {/* Names the group for a screen reader without adding a heading */}
      <legend className="sr-only">Filter and sort your match history</legend>

      <div className="flex min-w-48 flex-1 basis-full flex-col gap-2 sm:basis-64">
        <Label htmlFor={searchFieldId}>Opponent</Label>
        {/*`type="search"` for the platform's own clear button (⌫ on iOS, ✕ in Chrome) */}
        <Input
          id={searchFieldId}
          type="search"
          value={filters.query}
          onChange={(event) => onChange({ ...filters, query: event.target.value }, true)}
          placeholder="Player or team name…"
        />
      </div>

      <div className="flex min-w-40 flex-1 flex-col gap-2 sm:max-w-56">
        <Label htmlFor={gameFieldId}>Game</Label>
        <Select
          id={gameFieldId}
          value={filters.gameId ?? ''}
          onChange={(event) => {
            const gameId = event.target.value || undefined;
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

      <label className="flex min-h-12 cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          className="focus-ring size-4 shrink-0 accent-action-primary"
          checked={filters.oldestFirst}
          onChange={(event) => onChange({ ...filters, oldestFirst: event.target.checked })}
        />
        <span className="text-sm text-text-secondary">Oldest first</span>
      </label>
    </fieldset>
  );
}
