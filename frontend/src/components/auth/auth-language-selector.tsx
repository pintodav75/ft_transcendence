import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ChevronDown, Languages } from 'lucide-react';

import { cn } from '@/lib/utils';

const languages = [
  { code: 'en', shortLabel: 'EN', label: 'English' },
  { code: 'fr', shortLabel: 'FR', label: 'Français' },
  { code: 'es', shortLabel: 'ES', label: 'Español' },
] as const;

export type LanguageCode = (typeof languages)[number]['code'];

type AuthLanguageSelectorProps = {
  className?: string;
  defaultLanguage?: LanguageCode;
  onLanguageChange?: (language: LanguageCode) => void;
};

export function AuthLanguageSelector({
  className,
  defaultLanguage = 'en',
  onLanguageChange,
}: AuthLanguageSelectorProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedCode, setSelectedCode] = useState<LanguageCode>(defaultLanguage);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = languages.findIndex((language) => language.code === selectedCode);
  const selectedLanguage = languages[selectedIndex] ?? languages[0];

  useEffect(() => {
    if (!menuOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    const animationFrame = requestAnimationFrame(() => {
      optionRefs.current[selectedIndex]?.focus();
    });

    return () => cancelAnimationFrame(animationFrame);
  }, [menuOpen, selectedIndex]);

  const closeMenu = (restoreTriggerFocus = false) => {
    setMenuOpen(false);

    if (restoreTriggerFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  const selectLanguage = (code: LanguageCode) => {
    setSelectedCode(code);
    onLanguageChange?.(code);
    closeMenu(true);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setMenuOpen(true);
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const focusedIndex = optionRefs.current.findIndex(
      (option) => option === document.activeElement,
    );

    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
      return;
    }

    let nextIndex: number | null = null;

    if (event.key === 'ArrowDown') {
      nextIndex = (focusedIndex + 1 + languages.length) % languages.length;
    } else if (event.key === 'ArrowUp') {
      nextIndex = (focusedIndex - 1 + languages.length) % languages.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = languages.length - 1;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      optionRefs.current[nextIndex]?.focus();
    }
  };

  return (
    <div
      ref={rootRef}
      className={cn('relative', className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setMenuOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="flex h-8 items-center gap-2 rounded-control px-2 font-bold transition hover:text-text-primary focus-ring focus-visible:outline-offset-2"
        aria-label={`Language: ${selectedLanguage.label}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onClick={() => setMenuOpen((open) => !open)}
        onKeyDown={handleTriggerKeyDown}
      >
        <Languages className="h-4 w-4" aria-hidden="true" />
        <span>{selectedLanguage.shortLabel}</span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition', menuOpen && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {menuOpen ? (
        <div
          id={menuId}
          className="absolute left-0 top-full z-20 mt-2 w-36 rounded-control border border-border-subtle bg-surface-card-strong p-1 shadow-card"
          role="menu"
          aria-label="Choose language"
          onKeyDown={handleMenuKeyDown}
        >
          {languages.map((language, index) => {
            const isSelected = selectedCode === language.code;

            return (
              <button
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                key={language.code}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                className={cn(
                  'flex w-full items-center justify-between rounded-control px-3 py-2 text-left transition hover:bg-surface-card hover:text-text-primary focus-ring',
                  isSelected ? 'text-text-primary' : 'text-text-secondary',
                )}
                onClick={() => selectLanguage(language.code)}
              >
                <span>{language.label}</span>
                <span className="text-[10px] font-bold">{language.shortLabel}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
