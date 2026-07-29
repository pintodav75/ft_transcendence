import { Link } from '@tanstack/react-router';

import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';

// The site logo (the VSMODE wordmark). Always a client-side link "home", where
// home depends on the session: logged-in users go to their dashboard (/home),
// visitors to the public landing (/). Brand identity (gradient, display font,
// weight, casing) is baked in; callers pass size/layout via className.
//
// ⚠️ NOT a heading. The wordmark is the same on every page, so it says nothing about
// where the user is — as an <h1> it would sit at the top of the headings list a screen
// reader user navigates by, ahead of the real page title, and inside a navigation
// landmark. Each page carries its own <h1>. (A second, near-identical component did
// wrap it in an <h1>; it was removed on 28/07 in favour of this one.)
export function SiteLogo({ className }: { className?: string }) {
  const user = useAuthStore((state) => state.user);
  const to = user ? '/home' : '/';

  return (
    <Link
      to={to}
      aria-label="VSMODE — accueil"
      className={cn(
        'text-arena-gradient font-display font-black uppercase leading-none tracking-tight',
        // Interaction states live here, not in the callers: it is one link, it should
        // answer to the mouse and to the keyboard the same way everywhere.
        'transition hover:opacity-90 focus-ring focus-visible:outline-offset-4',
        className,
      )}
    >
      VSMODE
    </Link>
  );
}
