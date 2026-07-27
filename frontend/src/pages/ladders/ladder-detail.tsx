import { Trophy } from 'lucide-react';
import { useParams } from '@tanstack/react-router';

// Placeholder: the full ladder page is its own ticket. It exists now so the "See the full
// ladder" link of a team's standings excerpt has a real destination — the excerpt only
// ever shows five rows around the team.
export function LadderDetail() {
  const { ladderId } = useParams({ from: '/_authenticated/ladders/$ladderId' });

  return (
    <div className="panel flex flex-col gap-3 p-6">
      <p className="flex items-center gap-2 text-xs label-caps text-success">
        <Trophy className="size-4" /> Ladder
      </p>
      <h1 className="text-3xl label-caps-black">Ladder</h1>
      <p className="font-mono text-xs text-text-muted">{ladderId}</p>
      <p className="max-w-prose text-sm text-text-secondary">
        This ladder page is coming in a later ticket: its rules, the map pool, and the full
        standings rather than the five rows shown around a team.
      </p>
    </div>
  );
}
