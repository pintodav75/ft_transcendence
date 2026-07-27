import { Swords } from 'lucide-react';
import { useParams } from '@tanstack/react-router';

// Placeholder: the match sheet is its own ticket. It exists now so a completed row of
// the team match history has a real destination instead of a dead link.
export function MatchDetail() {
  const { matchId } = useParams({ from: '/_authenticated/matches/$matchId' });

  return (
    <div className="panel flex flex-col gap-3 p-6">
      <p className="flex items-center gap-2 text-xs label-caps text-success">
        <Swords className="size-4" /> Match
      </p>
      <h1 className="text-3xl label-caps-black">Match sheet</h1>
      <p className="font-mono text-xs text-text-muted">{matchId}</p>
      <p className="max-w-prose text-sm text-text-secondary">
        This match page is coming in a later ticket: line-ups, Bo3 score, Elo change and
        dispute state will show up here.
      </p>
    </div>
  );
}
