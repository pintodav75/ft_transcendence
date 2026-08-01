import { useRef } from 'react';

import { panelId, tabId } from '@/components/ui/tab-ids';
import { cn } from '@/lib/utils';

import type { KeyboardEvent, ReactNode } from 'react';

export type TabItem = {
  id: string;
  label: string;
  icon?: ReactNode;
};

type TabsProps = {
  tabs: TabItem[];
  active: string;
  onSelect: (id: string) => void;
  /** Prefix of the tab/panel ids, so tabs and panels can reference each other. */
  idPrefix: string;
  label: string;
  variant?: 'default' | 'icon';
};

// Generic WAI-ARIA tab strip: it knows nothing of teams or matches, it renders whatever
// `tabs` holds. Adding a tab is appending one entry — no change here (FT-2B does exactly
// that for its captain-only "Manage" tab).
export function Tabs({ tabs, active, onSelect, idPrefix, label, variant = 'default' }: TabsProps) {
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
    <div className={cn('border-b border-border-subtle', variant === 'icon' && 'p-2')}>
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

          if (variant === 'icon') {
            return (
              <div key={tab.id} className="group relative flex flex-1 justify-center">
                <button
                  type="button"
                  role="tab"
                  id={tabId(idPrefix, tab.id)}
                  aria-label={tab.label}
                  aria-selected={selected}
                  aria-controls={panelId(idPrefix, tab.id)}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onSelect(tab.id)}
                  className={cn(
                    'peer focus-ring relative flex min-h-11 w-full items-center justify-center rounded-control px-2 py-2 text-text-secondary transition hover:bg-surface-card-strong hover:text-text-primary',
                    selected && 'bg-surface-card-strong text-text-primary',
                  )}
                >
                  {tab.icon}
                  {selected && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-4 -bottom-2 h-0.5 bg-arena-red"
                    />
                  )}
                </button>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-control border border-border-subtle bg-surface-card-strong px-2 py-1 text-sm font-medium text-text-primary opacity-0 shadow-card transition-opacity group-hover:opacity-100 peer-focus-visible:opacity-100"
                >
                  {tab.label}
                </span>
              </div>
            );
          }

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
                // ⚠️ `px-3` SOUS 640 px, ET C'EST UNE EXIGENCE, PAS UN GOÛT : à 320 px — la largeur
                // exacte que WCAG 1.4.10 impose de tenir sans défilement horizontal — les trois
                // onglets en `px-4` dépassaient de 0,9 px et faisaient scroller la PAGE ENTIÈRE.
                // On resserre plutôt que d'ajouter un `overflow-x-auto`, pour la raison expliquée
                // sur le `role="tablist"` juste au-dessus.
                'focus-ring -mb-px border-b-2 px-3 py-3 text-xs label-caps transition sm:px-4',
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
