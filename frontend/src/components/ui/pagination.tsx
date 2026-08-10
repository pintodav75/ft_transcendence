import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useId } from 'react';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

/**
 * Generic over the page size so a caller offering a closed set of literals (`[10, 25, 50,
 * 100] as const`) is handed one of ITS OWN values back, not a bare `number` it would have to
 * cast — the same guard the Format filter gets from matching against its options.
 */
type PaginationProps<Size extends number> = {
  /** 1-based, and expected to be already clamped into `1…pageCount` by the caller. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** How many rows a page holds, and the sizes offered — smallest first. */
  pageSize: Size;
  pageSizeOptions: readonly Size[];
  onPageSizeChange: (pageSize: Size) => void;
  /**
   * Rows in the whole list, every page together. It decides whether these controls are worth
   * rendering at all — see the visibility rule below.
   */
  total: number;
  /**
   * What is being paged, plural and lowercase ("matches", "results"). It names the `<nav>`
   * for a screen reader, which would otherwise hear "navigation" twice on a page that also
   * has the rail.
   */
  label: string;
};

/**
 * Page size, position, and previous / next over a paged list. **No domain knowledge
 * whatsoever** — which is why it lands in `ui/` on its first use rather than waiting for a
 * second consumer (`CLAUDE.md`, Composants). `/search` needs the same thing for its own
 * pagination step.
 *
 * 🚨 THE TWO HALVES APPEAR ON DIFFERENT CONDITIONS, and getting that wrong builds a control
 * the user cannot undo. The arrows are hidden on a single page — a dead pager is two tab stops
 * that lead nowhere, next to a "Page 1 of 1" the reader can already see. But the size selector
 * must NOT follow them: picking 100 on a 40-row list makes it a single page, and a selector
 * that hides itself on the value it was just given can never be set back to 10. So the
 * selector is bound to the TOTAL (can this list be paged at all, at any setting?) and only the
 * arrows are bound to `pageCount`.
 *
 * 🚨 NO LIVE REGION HERE, and this is the trap to know about (invariant #11): the page that
 * owns this pager owns exactly ONE announcement region, and it is the one that says what is
 * on screen now. A `role="status"` on the counter below would announce the page number and
 * the row count separately, out of order, from two regions — so changing page or size is
 * announced by the CALLER, through its own region.
 */
export function Pagination<Size extends number>({
  page,
  pageCount,
  onPageChange,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
  total,
  label,
}: PaginationProps<Size>) {
  const sizeFieldId = useId();

  // Below the smallest offer, NO setting produces a second page: the selector would be a
  // choice with one outcome, and the arrows would be dead on arrival.
  const smallest = Math.min(...pageSizeOptions);
  if (total <= smallest) return null;

  return (
    <nav
      aria-label={`Pages of ${label}`}
      className="flex flex-wrap items-center justify-between gap-4"
    >
      <div className="flex items-center gap-2.5">
        {/* A real <label>, so the select is reachable by its name and clicking the words
            opens it — the same reasoning as the checkboxes in `HistoryFilters`. */}
        <label htmlFor={sizeFieldId} className="text-xs text-text-secondary">
          Per page
        </label>
        <Select
          id={sizeFieldId}
          value={String(pageSize)}
          // Matched AGAINST the options we rendered rather than parsed blind: a value that is
          // not on offer must not reach the state, exactly as the Format filter does it.
          onChange={(event) => {
            const next = pageSizeOptions.find((size) => String(size) === event.target.value);
            if (next !== undefined) onPageSizeChange(next);
          }}
          // ⚠️ Width only. A `ui/` component BENDS, it is not rewritten (`CLAUDE.md`): `cn`
          // is tailwind-merge, so `w-24` replaces `w-full` and the height stays the system's
          // `h-12` — the same as the buttons on the other side of this bar.
          className="w-24"
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center gap-4">
          {/* ⚠️ `disabled`, never hidden: an arrow that disappears at the first and last page
              shifts the other one under a cursor that was about to click it. */}
          <Button
            variant="secondary"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="gap-1.5"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            Previous
          </Button>

          {/* `text-text-secondary` (7,81:1) and not `text-text-muted` (4,23:1, under AA) — the
              repo's known contrast debt on small grey lines, and this one carries the
              position. */}
          <p className="text-xs text-text-secondary">
            Page {page} of {pageCount}
          </p>

          <Button
            variant="secondary"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
            className="gap-1.5"
          >
            Next
            <ChevronRight aria-hidden="true" className="size-4" />
          </Button>
        </div>
      )}
    </nav>
  );
}
