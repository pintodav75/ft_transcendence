import { Link } from '@tanstack/react-router';

import {
  LegalList,
  LegalPage,
  LegalSection,
  MaintainerList,
} from '@/components/legal/legal-page';

/**
 * `/terms` — the Terms of Service.
 *
 * 🚨 A PLACEHOLDER HERE IS A REJECTION MOTIVE of the whole project. Like the Policy, this
 * text describes the platform AS BUILT, and every rule below maps onto something the code
 * actually enforces:
 *   · no game is played here, and there is no queue — challenge/accept, locked decision
 *   · both sides report a score; a disagreement opens a dispute; an admin arbitrates
 *   · the 24 h clocks on confirmation and on arbitration → `backend/src/jobs/index.ts`
 *   · you cannot leave a team, dissolve it, or delete your account mid-fixture → the 409s
 *     of `DELETE /teams/:id` and `DELETE /users/me`
 *   · upload limits → `IMAGE_MIME` / `EVIDENCE_MIME`
 * ⚠️ Do not add a rule the platform does not enforce, and do not promise a sanction nobody
 * can apply: admin powers stop at arbitrating a dispute and editing the database by hand.
 */
const CONTENTS = [
  { id: 'scope', title: 'What VSMODE is' },
  { id: 'account', title: 'Your account' },
  { id: 'fairplay', title: 'Reporting results' },
  { id: 'disputes', title: 'Disputes and arbitration' },
  { id: 'teams', title: 'Teams and captains' },
  { id: 'conduct', title: 'How to behave' },
  { id: 'content', title: 'What you upload' },
  { id: 'availability', title: 'Availability' },
  { id: 'termination', title: 'Leaving, and being removed' },
  { id: 'liability', title: 'Liability' },
  { id: 'changes', title: 'Changes to these terms' },
  { id: 'law', title: 'Applicable law' },
  { id: 'contact', title: 'Contact' },
] as const;

export function Terms() {
  return (
    <LegalPage
      title="Terms of Service"
      updatedAt="1 August 2026"
      contents={CONTENTS}
      intro={
        <>
          <p>
            These terms govern the use of VSMODE. Creating an account means accepting them; if
            you do not, do not create one.
          </p>
          <p>
            VSMODE is a student project, built by four students of{' '}
            <span className="text-text-primary">42</span> as their <em>ft_transcendence</em>{' '}
            project, the final assignment of the Common Core. It is free, it sells nothing, and
            it is provided{' '}
            <strong className="font-semibold text-text-primary">as is</strong>, with no
            guarantee of availability.
          </p>
        </>
      }
    >
      <LegalSection id="scope" title="1. What VSMODE is">
        <p>
          VSMODE organises, records and ranks competitive matches. It does{' '}
          <strong className="font-semibold text-text-primary">not</strong> host any game:
          matches are played on the game itself — Counter-Strike 2, League of Legends,
          chess.com — and the platform only tracks them. Nothing on this site is playable.
        </p>
        <p>
          There is no queue and no automatic matchmaking. One side opens a slot for a date and
          a format, another side accepts it, both play on the game, then both report the score
          and the ranking moves. Nowhere does the platform pick an opponent for you.
        </p>
        <p>
          Rankings, Elo and titles have no monetary value. They cannot be bought, sold,
          transferred or converted into anything. There is no prize, no entry fee and no
          gambling of any kind.
        </p>
      </LegalSection>

      <LegalSection id="account" title="2. Your account">
        <LegalList>
          <li>You must be at least 15 years old.</li>
          <li>
            One account per person. Sharing an account, lending it, or holding a second one to
            play against yourself or to farm ranking are breaches of these terms.
          </li>
          <li>
            The information you give must be accurate — starting with the game accounts you
            link, since they are what identifies you to an opponent.
          </li>
          <li>
            You are responsible for everything done from your account. Keep your password to
            yourself; two-factor authentication is available and recommended.
          </li>
          <li>
            A pseudo that impersonates someone, insults, or breaks the rules of §6 may be
            changed or the account removed.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="fairplay" title="3. Reporting results">
        <p>
          A match is settled by the two sides, not by the platform. Both report who won; if the
          two reports agree, the match closes and the Elo moves. If only one side reports and
          the other stays silent for 24 hours, the reported score is validated automatically —
          so do report, and do check what your opponent reported.
        </p>
        <p>These are breaches of these terms, and they are the ones we care about most:</p>
        <LegalList>
          <li>reporting a result you know to be false;</li>
          <li>agreeing with an opponent on a result that was not played;</li>
          <li>
            abandoning a match, or refusing to play a fixture you accepted, to avoid a loss;
          </li>
          <li>
            playing with someone other than the players fielded, or on an account other than
            the one you linked.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="disputes" title="4. Disputes and arbitration">
        <p>
          When the two sides report different winners, the match goes into dispute. Each side
          can attach evidence — a screenshot, a scoreboard, a match link — with a short
          description. An admin then looks at it and decides: the match is awarded, cancelled,
          or the reported score is confirmed. That decision is final and moves the Elo
          accordingly.
        </p>
        <p>
          If no admin has settled a dispute after 24 hours, it is cancelled automatically and
          the match returns to its previous state. Nobody wins by default.
        </p>
        <p>
          Evidence must be genuine and must be yours to share. Fabricating or doctoring
          evidence is one of the few things that will get an account removed without warning.
        </p>
      </LegalSection>

      <LegalSection id="teams" title="5. Teams and captains">
        <LegalList>
          <li>
            A team belongs to one ladder. Whoever creates it is its captain: they invite and
            remove members, open and accept slots, and field the players for each match.
          </li>
          <li>
            The captain answers for the line-ups they field. Fielding someone who does not play
            is on the captain, not on the player.
          </li>
          <li>
            A team cannot be dissolved, and a member cannot be removed, while the team is
            engaged in a fixture. Play it or cancel it first — the app tells you which one is
            in the way.
          </li>
          <li>
            A captain who wants to leave the platform dissolves the team first. Dissolving
            erases the team, its roster and its ranking; it does not erase the matches already
            played.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="conduct" title="6. How to behave">
        <p>The platform is small and everyone is identifiable. The rules are short:</p>
        <LegalList>
          <li>
            No harassment, threats, insults, or content that is racist, sexist, homophobic or
            otherwise hateful — in messages, in a pseudo, in a bio, in a team name or in a
            logo.
          </li>
          <li>No sexual content, no shock content, no illegal content.</li>
          <li>No spam, no advertising, no mass unsolicited messages.</li>
          <li>
            Do not impersonate another player, a team, or an admin; do not post someone
            else&apos;s personal data.
          </li>
          <li>
            Do not attack the platform: no automated scraping, no attempt to force an account,
            no abuse of an endpoint. If you find a security flaw, mail us (§13) instead of
            using it — we will thank you.
          </li>
        </LegalList>
        <p>
          You can block anyone at any time: the two of you stop seeing each other everywhere on
          the platform, and the person blocked is not told. Beyond that, we can remove content,
          correct a ranking obtained in breach of §3, and suspend or delete an account.
        </p>
      </LegalSection>

      <LegalSection id="content" title="7. What you upload">
        <p>
          Avatars, team logos, bios, messages and dispute evidence stay yours. By posting them
          you allow the platform to display them where the feature needs it — your profile,
          your team page, a conversation, a dispute file — and nowhere else. We do not reuse
          them for anything, we do not publish them elsewhere, and we claim no right beyond
          showing them in the app.
        </p>
        <p>
          You must hold the rights to what you upload: an avatar or a team logo that infringes
          someone else&apos;s work is your responsibility, and we remove it on notice.
        </p>
        <p>
          Practical limits: avatars and logos are PNG, JPEG or WebP images of at most 2 MB;
          dispute evidence may also be a PDF, up to 5 MB.
        </p>
      </LegalSection>

      <LegalSection id="availability" title="8. Availability">
        <p>
          This is a school project, not a service. It may be offline without notice, it may be
          reset, and the data may be lost in a migration or when the machine hosting it is
          reinstalled. Hosting will very likely stop once the project has been graded. Do not
          treat VSMODE as the archive of your competitive history.
        </p>
      </LegalSection>

      <LegalSection id="termination" title="9. Leaving, and being removed">
        <p>
          You can delete your account whenever you want, from your profile page. Two conditions
          first: no ongoing match, and if you are a captain, dissolve your team. What is erased
          and what survives is detailed in the{' '}
          <Link
            to="/privacy"
            className="rounded-control text-text-primary underline underline-offset-4 transition hover:opacity-90 focus-ring focus-visible:outline-offset-4"
          >
            Privacy Policy
          </Link>
          .
        </p>
        <p>
          On our side, we can suspend or delete an account that breaches these terms. For a
          minor breach we say so first; for cheating, fabricated evidence or harassment, we do
          not.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="10. Liability">
        <p>
          VSMODE is provided as is, with no warranty of any kind: no promise that it works, that
          it stays available, or that it fits any particular purpose. We are not liable for a
          lost ranking, a match that could not be played, data lost in a reset, or anything that
          happens between players inside the games themselves — those have their own rules and
          their own moderation, and we have no power there.
        </p>
        <p>
          Nothing in this section excludes a liability that French law does not allow us to
          exclude.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="11. Changes to these terms">
        <p>
          These terms follow the platform. When it changes, the text changes and the date at the
          top is updated; continuing to use your account means accepting the new version. Every
          previous version is kept in the project&apos;s Git history.
        </p>
      </LegalSection>

      <LegalSection id="law" title="12. Applicable law">
        <p>
          These terms are governed by French law. Any dispute that cannot be settled amicably
          falls to the competent French courts. As a reminder, the platform is run by four
          students, not by a company.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="13. Contact">
        <p>
          For any question about these terms, to report a breach, or to tell us about a security
          flaw, write to any of us:
        </p>
        <MaintainerList />
        <p>
          What the platform stores about you is described in the{' '}
          <Link
            to="/privacy"
            className="rounded-control text-text-primary underline underline-offset-4 transition hover:opacity-90 focus-ring focus-visible:outline-offset-4"
          >
            Privacy Policy
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}

export default Terms;
