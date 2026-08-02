// Auth actions, rendered as the bottom section of the left rail.
//
// 🚨 CE COMPOSANT NE VIT QUE DERRIÈRE LA GARDE D'AUTHENTIFICATION. Ses deux seuls appelants
// (`LeftRail` et le tiroir du `MobileHeader`) sont montés par `AuthenticatedLayout` : ce qui
// s'affiche ici s'adresse donc TOUJOURS à quelqu'un de connecté.
//
// Ça n'a pas toujours été vrai — il servait aussi de bloc bas au rail de la landing publique,
// et portait pour ça une paire de liens « Login / Sign up » et des gardes `isLogged`. Le rail
// de la landing ayant été retiré, cette branche ne pouvait plus s'afficher : elle a été
// supprimée avec ses gardes devenues toujours vraies. ⚠️ Remonter ce composant sur une page
// publique reviendrait à poser un `<dialog>` « Log out » dans le DOM d'un visiteur anonyme —
// c'est exactement le défaut qui avait imposé ces gardes (son `<h2>` devenait le premier titre
// de la landing, avant son propre `<h1>`). Le refaire demanderait de les réintroduire.

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
  // Logging out throws away an open session, and the item sits one pixel below "Profile"
  // in a rail that is on EVERY authenticated page: a mis-click used to end the session
  // with no way back other than typing the password again.
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      // `logout()` du store avale déjà l'échec réseau (try/catch/finally) et vide la
      // session localement : il ne rejette pas, donc pas d'état d'erreur à afficher ici.
      // Le `finally` reste la garantie que la boîte ne peut pas rester bloquée en
      // « Working… » si cette promesse changeait un jour de comportement.
      await logout();
    } finally {
      setPending(false);
      setConfirming(false);
    }
    navigate({ to: '/' });
  }

  return (
    <div className={cn('flex flex-col border-t border-border-subtle', className)}>
      {/* Nommé : c'est le SECOND landmark de navigation du rail, deux « navigation » sans
          nom seraient impossibles à distinguer dans la liste des repères. */}
      <nav aria-label="Account" className="flex flex-col gap-0.5">
        <MenuItem to="/profile">
          <UserPen className="size-4" /> Profile
        </MenuItem>
        <MenuItem onClick={() => setConfirming(true)}>
          <LogOut className="size-4" /> Logout
        </MenuItem>
      </nav>

      {/* `tone="primary"` : se déconnecter n'efface rien, ce n'est pas une action destructrice.
          Pas de `returnFocusRef` non plus — le bouton qui ouvre la boîte survit à l'annulation,
          la plateforme lui rend donc le focus toute seule. */}
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
