// Bandeau d'alerte : tant qu'aucun compte de jeu n'est lié+vérifié, le joueur
// ne peut pas rejoindre une lineup (garde §5.1). Le bouton renvoie vers le
// flux de liaison de compte externe (external-accounts).

import { Button } from '@/components/ui/button';

type LinkAccountBannerProps = {
  // Fournisseur à lier (Riot, Steam, Epic…) — interpolé dans le titre.
  provider?: string;
  // Action déclenchée par le bouton (ouverture du flux de liaison).
  onLink?: () => void;
};

export function LinkAccountBanner({ provider = 'Riot', onLink }: LinkAccountBannerProps) {
  return (
    <section
      aria-label={`Lier ton compte ${provider}`}
      className="rounded-card border border-arena-red/60 bg-arena-red-soft/50 px-6 py-5 shadow-card"
    >
      <h3 className="text-base font-bold text-text-primary">
        Link your {provider} account to start matchmatching
      </h3>
      <p className="mt-1 text-sm text-text-secondary">
        Without verified account, you cannot enter the queue.
      </p>
      <Button onClick={onLink} className="mt-4">
        Link my account
      </Button>
    </section>
  );
}
