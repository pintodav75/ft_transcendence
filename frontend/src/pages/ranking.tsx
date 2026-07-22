import { useState } from 'react';
import { Trophy } from 'lucide-react';

import { LadderSelect } from '@/components/home/LadderSelect';
import { RankingTable } from '@/components/home/RankingTable';

export function Ranking() {
  const [ladderId, setLadderId] = useState<string>();

  return (
    <div className="flex min-h-full flex-col gap-6 py-6">
      <header className="space-y-1">
        <p className="flex items-center gap-2 text-xs label-caps text-success">
          <Trophy className="size-4" /> Leaderboards
        </p>
        <h1 className="text-3xl label-caps-black">Rankings</h1>
      </header>

      <LadderSelect value={ladderId} onChange={setLadderId} />
      {/* note: the teams are not clickable because backend doesnt give .id for each teams */}
      <RankingTable ladderId={ladderId} />
    </div>
  );
}

export default Ranking;
