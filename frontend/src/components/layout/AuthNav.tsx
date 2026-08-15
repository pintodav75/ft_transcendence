// Auth actions, rendered as the bottom section of the left rail. CE COMPOSANT NE VIT QUE
// DERRIÈRE LA GARDE D'AUTHENTIFICATION.

import { useState } from 'react';
import { LogOut, UserPen } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';

import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { MenuItem } from '@/components/ui/menu-item';
import { useAuthStore } from '@/stores/auth-store';

export function AuthNav({ className }: { className?: string }) {
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  // Logging out throws away an open session, and the item sits one pixel below "Profile" in a
  // rail that is on EVERY authenticated page: a mis-click used to end the session with no way
  // back other than typing the password again.
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      // `logout()` du store avale déjà l'échec réseau (try/catch/finally) et vide la session
      // localement : il ne rejette pas, donc pas d'état d'erreur à afficher ici.
      await logout();
    } finally {
      setPending(false);
      setConfirming(false);
    }
    navigate({ to: '/' });
  }

  return (
    <div className={cn('flex flex-col border-t border-border-subtle', className)}>

      <nav aria-label="Account" className="flex flex-col gap-0.5">
        <MenuItem to="/profile">
          <UserPen aria-hidden="true" className="size-4" /> Profile
        </MenuItem>
        <MenuItem onClick={() => setConfirming(true)}>
          <LogOut aria-hidden="true" className="size-4" /> Logout
        </MenuItem>
      </nav>

      <ConfirmDialog
        open={confirming}
        tone="primary"
        title="Log out"
        description="You will be signed out and sent back to the public page. Your teams and matches are not affected."
        confirmLabel="Log out"
        // Pas « Cancel » : dans une boîte « Log out ? », annuler QUOI est ambigu (la
        // déconnexion, ou l'action qu'on menait avant ?). Le libellé nomme le résultat.
        cancelLabel="Stay signed in"
        pending={pending}
        onConfirm={() => void handleLogout()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
