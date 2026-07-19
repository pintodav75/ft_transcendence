import { useState } from 'react';
import { Trophy } from 'lucide-react';

import { LeftNav } from '@/components/layout/LeftNav';
import { RightNav } from '@/components/layout/RightNav';
import { SiteFooter } from '@/components/layout/SiteFooter';

import { LadderSelect } from '@/components/home/LadderSelect';
import { RankingTable } from '@/components/home/RankingTable';

export function Games() {
  const [ladderId, setLadderId] = useState<string>();

  return (
    <main className="relative h-screen overflow-hidden">
      <LeftNav />
      <RightNav />

      <div className="relative z-10 h-screen overflow-y-auto">
        <div className="flex min-h-screen flex-col gap-6 pl-80 pr-28 pt-10">
          <header className="space-y-1">
            <p className="flex items-center gap-2 text-xs label-caps text-success">
              <Trophy className="size-4" /> Leaderboards
            </p>
            <h1 className="text-3xl label-caps-black">Rankings</h1>
          </header>

          <LadderSelect value={ladderId} onChange={setLadderId} />
          {/* note: the teams are not clickable because backend doesnt give .id for each teams */}
          <RankingTable ladderId={ladderId} />

          <SiteFooter />
        </div>
      </div>
    </main>
  );
}

export default Games;
