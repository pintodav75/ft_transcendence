import { useEffect, useRef, useState } from 'react';

import { SiteLogo } from '@/components/layout/SiteLogo';
import { SocialPanel } from '@/components/social/SocialPanel';
import { Avatar } from '@/components/ui/avatar';
import { useAuthStore } from '@/stores/auth-store';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function MobileHeader() {
  const [socialOpen, setSocialOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const user = useAuthStore((state) => state.user);
  const fallback = (user?.pseudo ?? '?').slice(0, 2).toUpperCase();

  useEffect(() => {
    if (!socialOpen) return;

    const trigger = triggerRef.current;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // Un dialogue enfant (les notifications) consomme d'abord Escape. Fermer les deux
        // couches d'un coup ferait perdre le contexte alors que l'utilisateur voulait
        // simplement revenir au panneau social.
        if (dialog?.querySelector('[role="dialog"]')) return;

        event.preventDefault();
        setSocialOpen(false);
        return;
      }

      if (event.key !== 'Tab' || !dialog) return;

      const focusableElements = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);

      if (!firstElement || !lastElement) return;

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      trigger?.focus();
    };
  }, [socialOpen]);

  return (
    <>
      <header className="sticky top-2 z-20 -mx-2 -mt-2 mb-3 flex h-14 items-center justify-between rounded-card bg-surface-header/95 px-4 backdrop-blur lg:hidden">
        <SiteLogo compact className="text-3xl" />

        <button
          ref={triggerRef}
          type="button"
          onClick={() => setSocialOpen(true)}
          className="focus-ring rounded-full transition hover:opacity-90"
          aria-label="Open social panel"
          aria-haspopup="dialog"
          aria-expanded={socialOpen}
          aria-controls={socialOpen ? 'mobile-social-panel' : undefined}
        >
          <Avatar
            src={user?.avatarUrl}
            alt=""
            fallback={fallback}
            className="size-11"
          />
        </button>
      </header>

      {socialOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setSocialOpen(false)}
            className="absolute inset-0 bg-background-app/85"
            aria-hidden="true"
          />
          <section
            ref={dialogRef}
            id="mobile-social-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Social"
            className="panel absolute inset-3 overflow-hidden"
          >
            <SocialPanel onClose={() => setSocialOpen(false)} />
          </section>
        </div>
      )}
    </>
  );
}
