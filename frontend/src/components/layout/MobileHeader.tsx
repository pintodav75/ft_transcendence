import { useEffect, useRef, useState } from 'react';

import { SiteLogo } from '@/components/layout/SiteLogo';
import { SocialPanel } from '@/components/social/SocialPanel';
import { Avatar } from '@/components/ui/avatar';
import { useUnreadNotificationCount } from '@/lib/notifications';
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
  /**
   * 🚨 SOUS 1024 px, CE BOUTON EST LE SEUL ENDROIT OÙ UNE NOTIFICATION PEUT SE VOIR. La pastille
   * de la cloche vit dans le panneau social, dont le rail est masqué à cette largeur et dont
   * l'overlay n'est monté qu'à l'ouverture : sans ce point, un téléphone n'annonce rien tant
   * qu'on n'a pas ouvert le panneau — donc au hasard.
   *
   * ⚠️ `useUnreadNotificationCount`, JAMAIS `useNotificationBell` : ce dernier porte l'abonnement
   * qui incrémente le compteur et doit rester monté une seule fois (`SocialPanel`), sans quoi
   * chaque notification serait comptée deux fois. Ici on ne fait que LIRE le même cache — le
   * rail permanent est `hidden lg:block`, donc monté à toute largeur, et la requête existe déjà.
   */
  const unreadCount = useUnreadNotificationCount();

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
          className="focus-ring relative rounded-full transition hover:opacity-90"
          // 🔑 LE NOMBRE EST DANS LE NOM, pas seulement dans la pastille : celle-ci est
          // `aria-hidden` (un point coloré ne dit rien), donc c'est cette phrase qui porte
          // l'information pour un lecteur d'écran comme pour le pilotage à la voix.
          aria-label={
            unreadCount > 0
              ? `Open social panel, ${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}`
              : 'Open social panel'
          }
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
          {unreadCount > 0 && (
            // Un point, pas un compteur : la cloche du panneau porte le chiffre exact, ce
            // déclencheur n'a qu'à dire « il y a quelque chose ». La bordure reprend le fond
            // de l'en-tête pour détacher la pastille de l'avatar sous elle.
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-surface-header bg-arena-red"
            />
          )}
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
