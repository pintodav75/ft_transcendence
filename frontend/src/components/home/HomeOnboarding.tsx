import { Link } from '@tanstack/react-router';

import { SectionTitle } from '@/components/ui/section-title';
import { buttonClasses } from '@/components/ui/button-variants';

import type { ReactNode } from 'react';

/**
 * The three steps that turn a fresh account into one that can play. This is the DEFAULT
 * content of /home, not a bonus: every other block of the page is conditional, so a new
 * account would otherwise land on a title and nothing else.
 *
 * shown on "no match in my history", not on "the page is empty" (see showOnboarding) — someone
 * on four teams who has never played is exactly who this is written for.
 * costs zero requests, it renders from what the page already knows.
 * no step is ever ticked done: knowing would cost a 6th request. they're just the three things
 * to do, each with the link that does it.
 * step 3 says there is no queue on purpose — challenge/accept is the first thing a newcomer
 * gets wrong.
 */
export function HomeOnboarding() {
  return (
    <div className="flex flex-col gap-3">
      <SectionTitle>First steps</SectionTitle>

      <p className="max-w-prose text-sm text-text-secondary">
        You have not played a match here yet. Three things stand between this page and your first
        one — they take a couple of minutes, and you can skip any that are already done.
      </p>

      <ol role="list" aria-label="First steps" className="flex flex-col gap-2">
        <Step
          number={1}
          title="Link a game account"
          to="/profile"
          action="Open my profile"
        >
          Every game here is played somewhere else — on Steam, Riot or chess.com. Until the
          account a game requires is linked, no slot can be opened with you in the line-up.
        </Step>

        <Step number={2} title="Create or join a team" to="/teams" action="Go to my teams">
          Anything above 1v1 is played by a team: create one on the ladder you want, or accept an
          invitation. Skip this if you only plan to play 1v1.
        </Step>

        <Step number={3} title="Open a slot — or take one" to="/games" action="Browse the games">
          Pick a ladder and open a slot at a time that suits you; anyone may accept it. There is
          no queue and no automatic pairing on this platform: you either wait for someone to take
          your slot, or you take theirs from the matchmaking board.
        </Step>
      </ol>
    </div>
  );
}

type StepProps = {
  number: number;
  title: string;
  /**
   * The literal union of the router, not `string`: a typo in a path has to break the build here
   * rather than send a newcomer to a 404 — which would also print a red line in the console, a
   * project-rejection criterion.
   */
  to: '/profile' | '/teams' | '/games';
  action: string;
  children: ReactNode;
};

function Step({ number, title, to, action, children }: StepProps) {
  return (
    <li className="flex gap-3 rounded-control border border-border-subtle bg-surface-card-strong/60 px-4 py-3">
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border-strong font-mono text-xs font-bold text-text-secondary"
      >
        {number}
      </span>

      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-bold text-text-primary">{title}</span>
        <span className="max-w-prose text-sm text-text-secondary">{children}</span>

        <Link to={to} className={buttonClasses('secondary', 'mt-1 self-start')}>
          {action}
        </Link>
      </span>
    </li>
  );
}
