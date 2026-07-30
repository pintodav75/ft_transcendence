import { UserRound } from 'lucide-react';
import { useParams } from '@tanstack/react-router';

import { BackButton } from '@/components/ui/back-link';

// Placeholder: the public profile is its own ticket. It exists now so every roster
// chip of the team detail page points at a real route instead of a dead link.
export function PlayerDetail() {
  const { pseudo } = useParams({ from: '/_authenticated/players/$pseudo' });

  return (
    <div className="flex min-w-0 flex-col gap-6 py-6">
      {/* This was the only page of the app with no way out: every other one carries a back
          link, but this one is a leaf reached from half a dozen different boards. */}
      <BackButton />

      <div className="panel flex flex-col gap-3 p-6">
        <p className="flex items-center gap-2 text-xs label-caps text-success">
          <UserRound className="size-4" /> Player
        </p>
        <h1 className="text-3xl label-caps-black">@{pseudo}</h1>
        <p className="max-w-prose text-sm text-text-secondary">
          This public profile is coming in a later ticket: stats, teams and match history for
          this player will show up here.
        </p>
      </div>
    </div>
  );
}
