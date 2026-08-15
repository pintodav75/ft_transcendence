import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useId } from 'react';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

/**
 * Generic over the page size so a caller offering a closed set of literals (`[10, 25, 50, 100]
 * as const`) is handed one of ITS OWN values back, not a bare `number` it would have to cast —
 * the same guard the Format filter gets from matching against its options.
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
  /** What is being paged, plural and lowercase ("matches", "results"). */
  label: string;
};

/** Page size, position, and previous / next over a paged list. */
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

  // Below the smallest offer, NO setting produces a second page: the selector would be a choice
  // with one outcome, and the arrows would be dead on arrival.
  const smallest = Math.min(...pageSizeOptions);
  if (total <= smallest) return null;

  return (
    <nav
      aria-label={`Pages of ${label}`}
      className="flex flex-wrap items-center justify-between gap-4"
    >
      <div className="flex items-center gap-2.5">

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
          // Width only.
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

          <Button
            variant="secondary"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="gap-1.5"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            Previous
          </Button>

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
