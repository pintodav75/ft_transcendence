// Left rail, full-height floating panel.
// placeholders at the top;
// language + auth pinned to the bottom (AuthNav).

import { Play, Trophy, Search, Gamepad2, Shield, Plus } from 'lucide-react';

import { MenuItem } from '@/components/ui/menu-item';
import { AuthNav } from '@/components/layout/AuthNav';

export function LeftNav() {
  return (
    <div className="panel fixed bottom-4 left-4 top-4 z-20 flex w-72 flex-col p-6">
      <h1 className="text-arena-gradient font-display text-center text-5xl font-black uppercase leading-none tracking-tight">
        VSMODE
      </h1>

      <nav className="mt-8 flex flex-col items-start gap-1">
        <MenuItem>
          <Play className="size-5" /> play
        </MenuItem>
        <MenuItem>
          <Trophy className="size-5" /> ranking
        </MenuItem>
        <MenuItem>
          <Search className="size-5" /> find party
        </MenuItem>
        <MenuItem>
          <Gamepad2 className="size-5" /> games
        </MenuItem>
      </nav>

      <span className="my-4 select-none px-3 text-text-muted">---</span>

      {/* Non-functional placeholders, disabled on purpose to show what it would look like*/}
      <nav className="flex flex-col items-start gap-1">
        <MenuItem muted disabled>
          <Shield className="size-5" /> club
        </MenuItem>
        <MenuItem muted disabled>
          <Plus className="size-5" /> new club
        </MenuItem>
      </nav>

      {/* language + auth, pinned to the bottom of the rail */}
      <AuthNav className="mt-auto pt-6" />
    </div>
  );
}
