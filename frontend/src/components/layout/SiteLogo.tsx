import { Link } from '@tanstack/react-router';

import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';

// The site logo (the VSMODE wordmark). Always a client-side link "home", where
// home depends on the session: logged-in users go to their dashboard (/home),
// visitors to the public landing (/). Brand identity (gradient, display font,
// weight, casing) is baked in; callers pass size/layout via className.
export function SiteLogo({ className }: { className?: string }) {
  const user = useAuthStore((state) => state.user);
  const to = user ? '/home' : '/';

  return (
    <Link
      to={to}
      aria-label="VSMODE — accueil"
      className={cn(
        'text-arena-gradient font-display font-black uppercase leading-none tracking-tight',
        className,
      )}
    >
      VSMODE
    </Link>
  );
}
