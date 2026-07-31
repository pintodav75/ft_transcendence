import { useEffect, useId, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { KeyboardEvent, ReactNode } from 'react';

export type ActionMenuItem = {
  /** Stable React key, and the id a test can target. */
  id: string;
  label: string;
  /** Rendered before the label, `aria-hidden` is the caller's job. */
  icon?: ReactNode;
  /** `danger` for a destructive action, same red as `InlineButton`'s danger tone. */
  tone?: 'default' | 'danger';
  onSelect: () => void;
};

type ActionMenuProps = {
  /**
   * Accessible name of the trigger. It must NAME THE ROW, never be a bare "Actions": a list
   * of eight identical "Actions" buttons tells a screen-reader user nothing about which one
   * they are on (`Actions for @bob`).
   */
  label: string;
  items: ActionMenuItem[];
  /** Menu's own accessible name; defaults to `label`. */
  menuLabel?: string;
  className?: string;
};

/**
 * Compact "⋮" button opening a short list of actions — the row-level menu of a list.
 *
 * PLATFORM-FIRST WHERE IT CAN BE: a real `<button>` trigger, real `<button>` items, so click,
 * Enter and Space all work without a line of code. What the platform does NOT give is the
 * menu-button keyboard contract, which is implemented here as the APG describes it: ArrowDown
 * on the trigger opens on the first item and ArrowUp on the last, arrows roll around the
 * items, Home/End jump to the ends, Escape closes and hands focus back to the trigger, a click
 * elsewhere or a Tab out closes it silently.
 *
 * 🔑 ROVING TABINDEX: the open menu holds exactly ONE tab stop. A menu is navigated with the
 * arrow keys, so Tab must LEAVE it — with an item per tab stop, tabbing off "Remove friend"
 * walked onto "Block player" instead of moving on, and a caller with five items would have
 * added five stops to the page. `activeIndex` is therefore the single source of truth for
 * both the tab stop and where the focus sits, and the effect below is what moves the focus.
 *
 * 🚨 SELECTING AN ITEM DOES NOT RESTORE FOCUS TO THE TRIGGER, on purpose. These actions open a
 * confirmation dialog, and a queued `focus()` racing a modal that has just taken focus is
 * exactly how a dialog opens with focus in the wrong place. The action decides where focus
 * goes — the menu only gets out of the way.
 *
 * ⚠️ It is positioned ABSOLUTELY inside the scrolling column that holds it, not in a portal.
 * That is why focus moves onto the first item when it opens: the browser then scrolls the item
 * into view for free, so a menu opened on the last row of the social rail is not left clipped
 * under the fold.
 */
export function ActionMenu({ label, items, menuLabel, className }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  /** The item that owns the tab stop and the focus. Reset every time the menu opens. */
  const [activeIndex, setActiveIndex] = useState(0);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Clamped at render: a caller may hand over a SHORTER `items` array between two renders
  // (an action that stops applying), and an index left pointing past the end would leave the
  // menu with no tab stop at all.
  const rovingIndex = items.length === 0 ? 0 : Math.min(activeIndex, items.length - 1);

  // React never clears the slots of the removed items, so a shrinking list would leave stale
  // nodes at the tail of the array — nodes that are detached, but that `findIndex`-style
  // lookups and `focus()` would still happily walk into.
  useEffect(() => {
    itemRefs.current.length = items.length;
  }, [items.length]);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [open]);

  // THE one place that moves the focus inside the menu: opening it and pressing an arrow are
  // the same operation seen from here — set `activeIndex`, the focus follows.
  useEffect(() => {
    if (!open) return;

    // Next frame: the menu is mounted by the very render this effect belongs to, and the
    // node has to exist before it can take focus.
    const frame = requestAnimationFrame(() => itemRefs.current[rovingIndex]?.focus());

    return () => cancelAnimationFrame(frame);
  }, [open, rovingIndex]);

  function closeAndRefocusTrigger() {
    setOpen(false);
    // After the menu is unmounted, otherwise the focus lands on a node React is removing.
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function openAt(index: number) {
    setActiveIndex(index);
    setOpen(true);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    // Without this the page scrolls under the menu that is opening.
    event.preventDefault();
    // APG: ArrowDown enters at the top, ArrowUp at the bottom — reaching the last action of
    // a long menu is then one key press instead of a full lap.
    openAt(event.key === 'ArrowDown' ? 0 : items.length - 1);
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      // 🚨 The Escape belongs to THIS menu and must stop here. The social rail is a
      // hand-rolled `aria-modal` overlay under 1024 px whose Escape handler sits on
      // `document`: without this, one press would close the menu AND the whole panel behind
      // it. React dispatches from the root container, so stopping the synthetic event does
      // stop the native one before it ever reaches `document`.
      event.stopPropagation();
      closeAndRefocusTrigger();
      return;
    }

    // Computed from `rovingIndex`, never from `document.activeElement`: the state is always
    // a valid index, where the DOM lookup returned -1 as soon as focus was anywhere else —
    // and -1 sent ArrowUp to the SECOND-TO-LAST item instead of the last.
    let nextIndex: number | null = null;

    if (event.key === 'ArrowDown') {
      nextIndex = (rovingIndex + 1) % items.length;
    } else if (event.key === 'ArrowUp') {
      nextIndex = (rovingIndex - 1 + items.length) % items.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = items.length - 1;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      setActiveIndex(nextIndex);
    }
  }

  return (
    <div
      ref={rootRef}
      className={cn('relative shrink-0', className)}
      onBlur={(event) => {
        // Tabbing out of the menu closes it. `relatedTarget` is null when focus leaves the
        // document entirely (another window) — the menu then stays open, which is what a user
        // coming back expects.
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          openAt(0);
        }}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          'focus-ring flex size-9 items-center justify-center rounded-control text-text-secondary transition hover:bg-surface-card-strong hover:text-text-primary',
          open && 'bg-surface-card-strong text-text-primary',
        )}
      >
        <MoreVertical className="size-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={menuLabel ?? label}
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-full z-30 mt-1 w-44 rounded-control border border-border-subtle bg-surface-card-strong p-1 shadow-card"
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              // The single tab stop of the menu (see the roving tabindex note above).
              tabIndex={index === rovingIndex ? 0 : -1}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                'focus-ring flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-sm transition',
                item.tone === 'danger'
                  ? 'text-arena-red hover:bg-arena-red/10'
                  : 'text-text-secondary hover:bg-surface-card hover:text-text-primary',
              )}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
