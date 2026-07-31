import { Link } from '@tanstack/react-router';

import { SectionTitle } from '@/components/ui/section-title';
import { buttonClasses } from '@/components/ui/button-variants';

import type { ReactNode } from 'react';

/**
 * The three steps that turn a fresh account into one that can play — and the DEFAULT content of
 * `/home`, not a bonus.
 *
 * 🔑 WHY IT EXISTS AT ALL. Every other block of this page is conditional (nothing coming up,
 * nothing on the clock, no invitation, no slot to take), so a brand new account would land on a
 * page with a title and nothing else. This is what it sees instead.
 *
 * 🚨 IT IS SHOWN ON « NO MATCH IN MY HISTORY », NOT ON « THE PAGE IS EMPTY » — see the page's
 * `showOnboarding`. A member of four teams who has never played is exactly the reader this is
 * written for, and the first version hid it from him because he had two slots he could accept.
 *
 * 🔑 IT COSTS ZERO REQUESTS. It is rendered from what the page already knows — "all four blocks
 * came back empty" — and it asks the API nothing. That is deliberate: the screen a new account
 * sees must not be the slowest one in the app.
 *
 * 🚨 THE STEPS DO NOT CLAIM TO KNOW WHERE YOU ARE. Ticking "done" on step 2 would need
 * `GET /teams`, i.e. a sixth request, so no step is shown as complete: these are the three
 * things to do, each carrying the link that does it — the same principle as a refusal on the
 * matchmaking board, which never states a problem without stating its remedy.
 *
 * 🚨 STEP 3 SAYS THERE IS NO QUEUE, ON PURPOSE. The model is challenge/accept: you open a slot
 * and somebody takes it, or you take somebody's. It is the first thing a newcomer gets wrong,
 * and this is the one screen written for newcomers.
 */
export function HomeOnboarding() {
  return (
    <div className="flex flex-col gap-3">
      <SectionTitle>First steps</SectionTitle>

      {/* 🚨 IT SAYS « NO MATCH YET », NOT « NOTHING NEEDS YOU ». The block used to appear only on
          a completely empty page, so the second sentence was true; it now appears as soon as the
          history is empty, and a reader in four teams with two acceptable slots right above this
          paragraph would have been told nothing needed him while the page said otherwise. The
          copy has to state the condition it is actually shown on. */}
      <p className="max-w-prose text-sm text-text-secondary">
        You have not played a match here yet. Three things stand between this page and your first
        one — they take a couple of minutes, and you can skip any that are already done.
      </p>

      {/* An `<ol>` so the ORDER is carried by the markup: the visible numbers are decoration
          (`aria-hidden`) and would otherwise be read twice. `role="list"` is explicit — Safari
          drops the list role from a list whose display is not `list-item`. */}
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
   * ⚠️ The literal union of the router, not `string`: a typo in a path has to break the build
   * here rather than send a newcomer to a 404 — which would also print a red line in the
   * console, a project-rejection criterion.
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
        {/* ⚠️ `secondary`, NOT `ghost`. Read on a screenshot, `ghost` (no border, no underline,
            `text-text-secondary`) made the only action of each step look like a caption under
            the paragraph — the affordance was invisible. `ghost` is the repo's idiom for a
            remedy sitting INSIDE a sentence, where its position carries the meaning; here it
            stands alone on its own line. It also gives the 24 px target WCAG 2.5.8 asks for,
            which the inline exception would not have covered. */}
        <Link to={to} className={buttonClasses('secondary', 'mt-1 self-start')}>
          {action}
        </Link>
      </span>
    </li>
  );
}
