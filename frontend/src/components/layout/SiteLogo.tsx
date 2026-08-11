import { Link } from '@tanstack/react-router';

import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';

// The site logo (the VSMODE wordmark).
export function SiteLogo({ className, compact = false }: { className?: string; compact?: boolean }) {
  const user = useAuthStore((state) => state.user);
  const to = user ? '/home' : '/';

  return (
    <Link
      to={to}
      aria-label="VSMODE — accueil"
      className={cn(
        'text-arena-gradient font-display font-black uppercase leading-none tracking-tight',
        // Interaction states live here, not in the callers: it is one link, it should answer to
        // the mouse and to the keyboard the same way everywhere.
        'transition hover:opacity-90 focus-ring focus-visible:outline-offset-4',
        className,
      )}
    >
      {compact ? 'VS' : 'VSMODE'}
    </Link>
  );
}
