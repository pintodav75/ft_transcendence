import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';

import { AuthNav } from '@/components/layout/AuthNav';
import { PrimaryNav } from '@/components/layout/PrimaryNav';
import { SiteLogo } from '@/components/layout/SiteLogo';
import { SocialPanel } from '@/components/social/SocialPanel';
import { Avatar } from '@/components/ui/avatar';
import { IconButton } from '@/components/ui/icon-button';
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

/**
 * Les deux tiroirs de l'en-tête mobile, dans UN SEUL état plutôt que deux booléens.
 *
 * 🚨 DEUX BOOLÉENS AUTORISERAIENT LES DEUX OUVERTS EN MÊME TEMPS — deux `aria-modal="true"`
 * empilés, un piège à focus qui se dispute l'autre, et aucun des deux `Escape` ne sachant lequel
 * il ferme. L'union rend l'état illégal inexprimable, et le piège à focus n'a qu'un seul tiroir
 * à connaître.
 */
type Panel = 'nav' | 'social';

export function MobileHeader() {
  const [openPanel, setOpenPanel] = useState<Panel | null>(null);
  const navTriggerRef = useRef<HTMLButtonElement>(null);
  const socialTriggerRef = useRef<HTMLButtonElement>(null);
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
    if (!openPanel) return;

    const trigger = openPanel === 'nav' ? navTriggerRef.current : socialTriggerRef.current;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // Un dialogue enfant (les notifications côté social, la confirmation de déconnexion côté
        // navigation) consomme d'abord Escape. Fermer les deux couches d'un coup ferait perdre le
        // contexte alors que l'utilisateur voulait simplement revenir au tiroir.
        if (dialog?.querySelector('[role="dialog"]')) return;

        event.preventDefault();
        setOpenPanel(null);
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
  }, [openPanel]);

  return (
    <>
      <header className="sticky top-2 z-20 -mx-2 -mt-2 mb-3 flex h-14 items-center justify-between rounded-card bg-surface-header/95 px-4 backdrop-blur lg:hidden">
        <div className="flex items-center gap-1">
          {/* 🚨 LE SEUL ACCÈS À LA NAVIGATION SOUS 1024 px. `LeftRail` est `hidden … lg:flex` : sans
              ce bouton, un téléphone n'a ni les six destinations, ni « Profile », ni « Logout » —
              et le sujet exige un front « accessible across all devices ». */}
          <IconButton
            ref={navTriggerRef}
            onClick={() => setOpenPanel('nav')}
            aria-label="Open navigation menu"
            aria-haspopup="dialog"
            aria-expanded={openPanel === 'nav'}
            aria-controls={openPanel === 'nav' ? 'mobile-nav-panel' : undefined}
            className="-ml-2"
          >
            <Menu className="size-5" />
          </IconButton>

          <SiteLogo compact className="text-3xl" />
        </div>

        <button
          ref={socialTriggerRef}
          type="button"
          onClick={() => setOpenPanel('social')}
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
          aria-expanded={openPanel === 'social'}
          aria-controls={openPanel === 'social' ? 'mobile-social-panel' : undefined}
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

      {openPanel === 'nav' && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setOpenPanel(null)}
            className="absolute inset-0 bg-background-app/85"
            aria-hidden="true"
          />
          <section
            ref={dialogRef}
            id="mobile-nav-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="panel absolute inset-3 flex flex-col overflow-y-auto px-4 py-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <SiteLogo className="text-2xl" />
              <IconButton onClick={() => setOpenPanel(null)} aria-label="Close navigation menu">
                <X className="size-5" />
              </IconButton>
            </div>

            {/* 🚨 FERMETURE PAR DÉLÉGATION, et pas sur un changement de `pathname` : re-cliquer la
                destination où l'on est DÉJÀ ne change pas l'URL, le tiroir serait resté ouvert sur
                un écran qu'il masque entièrement. Le test porte sur `<a>` uniquement, donc
                « Logout » (un `<button>`) laisse le tiroir en place pendant que sa confirmation
                s'affiche par-dessus. */}
            <div
              className="contents"
              onClick={(event) => {
                if ((event.target as HTMLElement).closest('a')) setOpenPanel(null);
              }}
            >
              <PrimaryNav />
              <AuthNav className="mt-auto pt-3" />
            </div>
          </section>
        </div>
      )}

      {openPanel === 'social' && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setOpenPanel(null)}
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
            <SocialPanel onClose={() => setOpenPanel(null)} />
          </section>
        </div>
      )}
    </>
  );
}
