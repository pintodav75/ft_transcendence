// This is the small box at the bottom left
// Language selector + auth actions. Rendered inside the LeftNav rail as its
// bottom section

import { ChevronDown, LogIn, LogOut, UserPen, UserPlus } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@/stores/auth-store';

import { cn } from '@/lib/utils';
import { MenuItem } from '@/components/ui/menu-item';

export function AuthNav({ className }: { className?: string }) {
  const isLogged = useAuthStore((state) => state.user !== null);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate({ to: '/' });
  }

  return (
    <div className={cn('flex flex-col gap-2 border-t border-border-subtle', className)}>
      {/* Language selector. appearance-none strips the OS chevron so we draw our own. */}
      <div className="relative">
        <select
          defaultValue="en"
          aria-label="language"
          className="w-full cursor-pointer appearance-none rounded-control border border-border-subtle bg-surface-input px-3 py-2 pr-9 text-sm label-caps text-text-primary transition focus:border-focus-ring focus:outline-none"
        >
          <option value="en">English</option>
          <option value="fr">Français</option>
          <option value="es">Español</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary" />
      </div>

      {!isLogged && (
        <div>
          <MenuItem to="/login">
            <LogIn className="size-5" /> login
          </MenuItem>
          <MenuItem to="/register">
            <UserPlus className="size-5" /> sign up
          </MenuItem>{' '}
        </div>
      )}

      {isLogged && (
        <div>
          <MenuItem to="/profile">
            <UserPen className="size-5" /> profile
          </MenuItem>
          <MenuItem onClick={handleLogout}>
            <LogOut className="size-5" /> logout
          </MenuItem>{' '}
        </div>
      )}
    </div>
  );
}
