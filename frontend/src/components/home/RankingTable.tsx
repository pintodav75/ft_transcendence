// This display the ranking of a specific ladderID

// takes as props ladderID

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';

type RankingProps = {
  ladderId: string | undefined;
};

// Literally the same types as in backend/src/utils/leaderboard.ts
// but since there's no shared types, we do it this way
type Competitor =
  | { type: 'user'; pseudo: string | null; displayName: string | null; avatarUrl: string | null }
  | { type: 'team'; name: string | null; logoUrl: string | null };

type RankingEntry = {
  rank: number;
  elo: number;
  wins: number;
  losses: number;
  competitor: Competitor;
};
// end dumb copy

function competitorName(competitor: Competitor) {
  return competitor.type === 'user'
    ? (competitor.displayName ?? competitor.pseudo ?? 'Unknown')
    : (competitor.name ?? 'Unknown team');
}

function competitorAvatarUrl(competitor: Competitor) {
  return competitor.type === 'user' ? competitor.avatarUrl : competitor.logoUrl;
}

const medalStyles: Record<number, { avatar: string; rank: string }> = {
  1: { avatar: 'size-14', rank: 'text-rank-gold' },
  2: { avatar: 'size-14', rank: 'text-rank-silver' },
  3: { avatar: 'size-14', rank: 'text-rank-bronze' },
};

export function RankingTable({ ladderId }: RankingProps) {
  const [rankings, setRankings] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount reset, no Query lib in use yet
    setLoading(true);
    setError(undefined);

    apiFetch<{ rankings: RankingEntry[] }>(`/ladders/${ladderId}/rankings`)
      .then(({ rankings }) => setRankings(rankings))
      .catch(() => setError('Could not load the rankings for this ladder.'))
      .finally(() => setLoading(false));
  }, [ladderId]);

  return (
    <div className="panel flex-1 overflow-hidden pb-2">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border-subtle text-xs label-caps text-text-muted">
            <th className="w-16 px-6 py-4">Rank</th>
            <th className="px-6 py-4">Player</th>
            <th className="px-6 py-4 text-right">Record</th>
            <th className="px-6 py-4 text-right">ELO</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={4} className="px-6 py-10 text-center text-sm text-text-muted">
                Loading…
              </td>
            </tr>
          )}
          {!loading && error && (
            <tr>
              <td colSpan={4} className="px-6 py-10 text-center text-sm text-text-muted">
                {error}
              </td>
            </tr>
          )}
          {!loading && !error && rankings.length === 0 && (
            <tr>
              <td colSpan={4} className="px-6 py-10 text-center text-sm text-text-muted">
                No ranked players yet on this ladder.
              </td>
            </tr>
          )}
          {!loading &&
            !error &&
            rankings.map((entry) => {
              const medal = medalStyles[entry.rank];
              return (
                <tr
                  key={entry.rank}
                  className="border-b border-border-subtle/60 last:border-0 hover:bg-surface-card-strong"
                >
                  <td
                    className={cn(
                      'px-6 py-3 font-bold',
                      medal ? medal.rank : 'text-text-secondary',
                      entry.rank <= 3 ? 'text-xl' : 'text-sm',
                    )}
                  >
                    #{entry.rank}
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex w-14 shrink-0 justify-center">
                        <Avatar
                          src={competitorAvatarUrl(entry.competitor) ?? undefined}
                          fallback={competitorName(entry.competitor).slice(0, 2).toUpperCase()}
                          className={cn('size-9', medal?.avatar)}
                        />
                      </div>
                      <span className="text-sm font-semibold text-text-primary">
                        {competitorName(entry.competitor)}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-3 text-right text-sm text-text-secondary">
                    {entry.wins}-{entry.losses}
                  </td>
                  <td className="px-6 py-3 text-right text-sm font-bold text-text-primary">
                    {entry.elo}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

export default RankingTable;
