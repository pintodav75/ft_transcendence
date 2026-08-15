// Les six (sept pour un admin) destinations de l'application, extraites du rail.

import { Flag, Gamepad2, Gavel, History, House, Swords, User } from 'lucide-react';

import { MenuItem } from '@/components/ui/menu-item';
import { Pill } from '@/components/ui/pill';
import { useDisputeQueue, useIsAdmin } from '@/lib/admin-disputes';

export function PrimaryNav() {
  /** L'onglet d'arbitrage. */
  const isAdmin = useIsAdmin();
  const disputeQueue = useDisputeQueue(isAdmin);
  const openDisputes = disputeQueue.data?.disputes.length ?? 0;

  return (
    <nav aria-label="Primary navigation" className="flex flex-col gap-0.5">
      <MenuItem to="/home">
        <House aria-hidden="true" className="size-4" /> Home
      </MenuItem>
      <MenuItem to="/teams">
        <Flag aria-hidden="true" className="size-4" /> My teams
      </MenuItem>
      <MenuItem to="/solo">
        <User aria-hidden="true" className="size-4" /> Solo
      </MenuItem>
      <MenuItem to="/games">
        <Gamepad2 aria-hidden="true" className="size-4" /> Games
      </MenuItem>
      <MenuItem to="/matchmaking">
        <Swords aria-hidden="true" className="size-4" /> Matchmaking
      </MenuItem>
      <MenuItem to="/history">
        <History aria-hidden="true" className="size-4" /> History
      </MenuItem>

      {isAdmin && (
        <MenuItem
          to="/admin/disputes"
          tone="accent"
          trailing={
            // Pas de badge à 0 (rien à arbitrer n'est pas une alerte), ni tant que la requête
            // n'a pas répondu — sinon la ligne saute de largeur une fois la réponse arrivée.
            openDisputes > 0 ? (
              <Pill tone="dispute">
                {openDisputes}

                <span className="sr-only">
                  {openDisputes === 1 ? ' open dispute' : ' open disputes'}
                </span>
              </Pill>
            ) : null
          }
        >
          <Gavel aria-hidden="true" className="size-4" /> Arbitration
        </MenuItem>
      )}
    </nav>
  );
}
