// Left rail, full-height floating panel.
// placeholders at the top;
// language + auth pinned to the bottom (AuthNav).

import { Play, Trophy, Search, Gamepad2, Swords } from 'lucide-react';

import { MenuItem } from '@/components/ui/menu-item';
import { AuthNav } from '@/components/layout/AuthNav';
import { Logo } from '@/components/layout/Logo';

export function LeftNav() {
  return (
    <div className="panel fixed bottom-4 left-4 top-4 z-20 flex w-72 flex-col p-6">
      <Logo className="text-center" />

      <nav className="mt-8 flex flex-col items-start gap-1">
        <MenuItem>
          <Play className="size-5" /> play
        </MenuItem>
        <MenuItem to="/teams">
          <Swords className="size-5" /> my teams
        </MenuItem>
        <MenuItem to="/ranking">
          <Trophy className="size-5" /> ranking
        </MenuItem>
        <MenuItem>
          <Search className="size-5" /> find party
        </MenuItem>
        <MenuItem to="/games">
          <Gamepad2 className="size-5" /> games
        </MenuItem>
      </nav>

      {/* <span className="my-4 select-none px-3 text-text-muted">---</span> */}

      {/* language + auth, pinned to the bottom of the rail */}
      <AuthNav className="mt-auto pt-6" />
    </div>
  );
}
