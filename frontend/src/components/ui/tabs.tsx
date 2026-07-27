import { useRef } from 'react';

import { panelId, tabId } from '@/components/ui/tab-ids';
import { cn } from '@/lib/utils';

import type { KeyboardEvent } from 'react';

export type TabItem = {
  id: string;
  label: string;
};

type TabsProps = {
  tabs: TabItem[];
  active: string;
  onSelect: (id: string) => void;
  /** Prefix of the tab/panel ids, so tabs and panels can reference each other. */
  idPrefix: string;
  label: string;
};

// Generic WAI-ARIA tab strip: it knows nothing of teams or matches, it renders whatever
// `tabs` holds. Adding a tab is appending one entry — no change here (FT-2B does exactly
// that for its captain-only "Manage" tab).
export function Tabs({ tabs, active, onSelect, idPrefix, label }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Roving tabindex + arrow keys: the WAI-ARIA tabs pattern. Without it Tab would stop on
  // every tab and the arrow keys would do nothing.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = tabs.findIndex((tab) => tab.id === active);
    if (current === -1) return;

    let next = -1;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;

    const target = next === -1 ? undefined : tabs[next];
    if (!target) return;

    event.preventDefault();
    onSelect(target.id);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div className="border-b border-border-subtle">
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={handleKeyDown}
        // No overflow-x-auto here: declaring a single axis forces the other one to `auto`
        // instead of `visible`, so the buttons' `-mb-px` — the 1px they deliberately bite
        // off the bottom hairline — was enough to raise a scrollbar. Three short tabs fit
        // at 375px anyway (measured).
        className="flex gap-1"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={tabId(idPrefix, tab.id)}
              aria-selected={selected}
              aria-controls={panelId(idPrefix, tab.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              className={cn(
                'focus-ring -mb-px border-b-2 px-4 py-3 text-xs label-caps transition',
                selected
                  ? 'border-b-arena-red text-text-primary'
                  : 'border-b-transparent text-text-muted hover:text-text-secondary',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
