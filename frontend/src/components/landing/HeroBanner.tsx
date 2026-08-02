// la baniere en haut de la home viewport

import { Link } from '@tanstack/react-router';

import { buttonClasses } from '@/components/ui/button-variants';
import bgUrl from '@/assets/images/bg.webp';

export function HeroBanner() {
  return (
    <section
      aria-label="Welcome to VSMODE"
      className="relative isolate overflow-hidden rounded-card border border-border-subtle shadow-card"
    >
      {/* background art */}
      <img
        src={bgUrl}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 -z-10 size-full object-cover object-[center_70%]"
      />
      <div className="absolute inset-0 -z-10 bg-linear-to-r from-arena-red-soft/95 via-arena-red-soft/60 to-transparent" />
      <div className="absolute inset-0 -z-10 bg-arena-gradient opacity-50 mix-blend-screen [clip-path:polygon(58%_0,100%_0,100%_100%,42%_100%)]" />

      <div className="max-w-155 px-8 py-8 md:px-12 md:py-10">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-success">
          Compete across 5 games
        </p>
        <h1 className="mt-4 font-display text-5xl font-black uppercase leading-[0.95] text-text-primary md:text-6xl">
          Compete.
          <br />
          Climb.
          <br />
          <span className="text-arena-gradient">Conquer.</span>
        </h1>
        <p className="mt-5 max-w-115 text-xs label-caps leading-6 text-white/70 md:text-sm">
          Challenge any team, agree on a time, then settle the score with both sides confirming the
          result. Climb an ELO ladder built for every game and format.
        </p>

        {/* CTA: links (they navigate), styled as buttons via buttonClasses. */}
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link to="/register" className={buttonClasses('primary')}>
            Join the arena
          </Link>
          <Link to="/login" className={buttonClasses('secondary')}>
            Enter the arena
          </Link>
        </div>
      </div>
    </section>
  );
}
