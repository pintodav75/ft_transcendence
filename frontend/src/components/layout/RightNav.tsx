// Right side of the home layout: avatar + secondary icon nav, right-aligned.

import { Bell, History, Users, MessagesSquare } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { IconMenuItem } from '@/components/ui/icon-menu-item';

export function RightNav() {
  return (
    <div className="panel fixed bottom-4 right-4 top-4 z-20 flex w-20 flex-col justify-between p-6">
      <div className="flex flex-col items-center gap-3">
        <Avatar
          fallback="you"
          className="m-2 size-16 border border-border-strong shadow-[0_0_20px_-6px_var(--action-primary)]"
        />
        <IconMenuItem label="Match history">
          <History aria-hidden="true" className="size-6" />
        </IconMenuItem>
        <IconMenuItem label="Notifications">
          <Bell aria-hidden="true" className="size-6" />
        </IconMenuItem>
        <IconMenuItem label="Party">
          <Users aria-hidden="true" className="size-6" />
        </IconMenuItem>
      </div>
      <div className="flex flex-col items-center">
        {/* friends / chat */}
        <IconMenuItem label="Chat">
          <MessagesSquare aria-hidden="true" className="size-6" />
        </IconMenuItem>
      </div>
    </div>
  );
}
