import { Link, type LinkProps } from '@tanstack/react-router';

import { cn } from '@/lib/utils';

// The VSMODE wordmark, and the page's <h1>.
// `text-arena-gradient` clips a background image to the glyphs, so it must sit on
// the element that directly holds the text — on a wrapper it would paint nothing,
// and the hover fade with it. Hence the <Link> carries the wordmark itself.
// `className` styles the <h1> box (alignment, spacing); the wordmark is fixed.

export function Logo({
  to = '/',
  className,
  arialabel = 'Back to home',
}: {
  to?: LinkProps['to'];
  className?: string;
  arialabel?: string;
}) {
  const wordmark =
    'text-arena-gradient italic font-display text-5xl font-black uppercase leading-none tracking-tight';

  return (
    <h1 className={cn('leading-none', className)}>
      {to ? (
        <Link
          to={to}
          aria-label={arialabel}
          className={cn(
            wordmark,
            'inline-block transition hover:opacity-90 focus-ring focus-visible:outline-offset-4',
          )}
        >
          VSMODE
        </Link>
      ) : (
        <span className={wordmark}>VSMODE</span>
      )}
    </h1>
  );
}
