import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SectionTitle } from '@/components/ui/section-title';
import { dissolveTeamErrorMessage, useDissolveTeam } from '@/lib/team-mutations';

type TeamDangerZoneProps = {
  teamId: string;
  teamName: string;
};

export function TeamDangerZone({ teamId, teamName }: TeamDangerZoneProps) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  // The hook owns the order "leave the page FIRST, then drop the cache entry": once the team is
  // deleted, any refetch of /teams/{id} is a 404, i.e. a red console line.
  const dissolve = useDissolveTeam(teamId, () => navigate({ to: '/teams', replace: true }));

  return (
    <section className="flex flex-col gap-3.5">
      <SectionTitle>Danger zone</SectionTitle>

      <div className="flex flex-wrap items-center gap-4 rounded-card border border-arena-red/40 bg-surface-card px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-sm font-bold text-text-primary">Dissolve this team</p>
          <p className="mt-1 text-xs text-text-secondary">
            Permanent. Every member loses the team, and its ladder line goes with it. A
            captain cannot leave a team — dissolving is the only way out.
          </p>
        </div>
        <Button variant="danger" className="ml-auto" onClick={() => setConfirming(true)}>
          Dissolve team
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Dissolve this team?"
        description={
          <>
            <strong className="text-text-primary">{teamName}</strong> and its roster will be
            deleted for everyone. This cannot be undone.
          </>
        }
        confirmLabel="Dissolve team"
        pending={dissolve.isPending}
        error={dissolve.isError ? dissolveTeamErrorMessage(dissolve.error) : null}
        onConfirm={() => dissolve.mutate()}
        onCancel={() => {
          dissolve.reset();
          setConfirming(false);
        }}
      />
    </section>
  );
}
