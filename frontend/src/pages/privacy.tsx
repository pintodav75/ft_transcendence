import { Link } from '@tanstack/react-router';

import {
  LegalList,
  LegalPage,
  LegalSection,
  MaintainerList,
} from '@/components/legal/legal-page';

/**
 * `/privacy` — the Privacy Policy. A placeholder here is a rejection motive for the project.
 *
 * every claim on this page describes what the code actually does:
 *   - stored columns          -> backend/src/db/schema.ts
 *   - the one and only cookie -> backend/src/auth/cookies.ts (refresh, 7 days)
 *   - what deletion erases    -> DELETE /users/me and the onDelete of each FK (messages,
 *     blocks and line-ups cascade; a played match keeps its score)
 *   - the two 24 h clocks     -> backend/src/jobs/index.ts
 *   - upload limits           -> IMAGE_MIME / EVIDENCE_MIME and the multipart limits
 * CHANGE THE CODE, CHANGE THIS PAGE. a policy that over-promises is worse than none.
 */
const CONTENTS = [
  { id: 'who', title: 'Who is behind VSMODE' },
  { id: 'collect', title: 'What we store' },
  { id: 'never', title: 'What we never collect' },
  { id: 'why', title: 'Why we store it' },
  { id: 'visibility', title: 'Who can see what' },
  { id: 'cookies', title: 'Cookies and sessions' },
  { id: 'retention', title: 'How long we keep it' },
  { id: 'deletion', title: 'Deleting your account' },
  { id: 'rights', title: 'Your rights' },
  { id: 'security', title: 'How we protect it' },
  { id: 'minors', title: 'Age requirement' },
  { id: 'changes', title: 'Changes to this policy' },
  { id: 'contact', title: 'Contact' },
] as const;

export function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      updatedAt="1 August 2026"
      contents={CONTENTS}
      intro={
        <>
          <p>
            VSMODE is a competitive platform for teams and solo players: it organises
            challenges, records results and maintains rankings for games that are played{' '}
            <strong className="font-semibold text-text-primary">elsewhere</strong> — on
            Counter-Strike 2, League of Legends or chess.com, not on this site.
          </p>
          <p>
            This policy says exactly what the platform stores about you, why, who can see it,
            and how to make it disappear. It describes the software as it is actually built,
            not what a template would say. If something here does not match what the app does,
            the policy is the one that is wrong — tell us.
          </p>
        </>
      }
    >
      <LegalSection id="who" title="1. Who is behind VSMODE">
        <p>
          VSMODE is a student project. It was built by four students of{' '}
          <span className="text-text-primary">42</span> as their <em>ft_transcendence</em>{' '}
          project, the final assignment of the Common Core. There is no company behind it, it
          sells nothing, it displays no advertising, and it has no commercial purpose
          whatsoever.
        </p>
        <p>
          The four of us are jointly responsible for the data described below. Our addresses
          are at the bottom of this page.
        </p>
      </LegalSection>

      <LegalSection id="collect" title="2. What we store">
        <p>Everything the platform holds about you falls into one of these groups.</p>
        <LegalList>
          <li>
            <strong className="font-semibold text-text-primary">Your account.</strong> Your
            email address, your pseudo, and — if you fill them in — a display name, a short
            bio and an avatar image. If you signed up with a password, we store a{' '}
            <em>bcrypt hash</em> of it and never the password itself. We also keep the date
            the account was created.
          </li>
          <li>
            <strong className="font-semibold text-text-primary">Google sign-in</strong>{' '}
            (optional). If you use it, Google gives us your email address and the identifier
            of your Google account, and we store both. We ask Google for nothing else — no
            contacts, no files, no calendar.
          </li>
          <li>
            <strong className="font-semibold text-text-primary">
              Two-factor authentication
            </strong>{' '}
            (optional). If you turn it on, we store the shared secret your authenticator app
            needs. Turning 2FA off deletes it.
          </li>
          <li>
            <strong className="font-semibold text-text-primary">Linked game accounts</strong>{' '}
            (optional). To be fielded in a match on a given game you can link the
            corresponding account: we store the provider (Steam, Riot, Epic, chess.com) and
            your identifier on it. We never receive your password on those services and we
            never play on your behalf.
          </li>
          <li>
            <strong className="font-semibold text-text-primary">Competitive activity.</strong>{' '}
            Your teams and the invitations you sent or received, the slots you opened or
            accepted, the matches you were fielded in, the scores each side reported, the
            resulting winner, your Elo, your wins and losses and your place in each ladder.
          </li>
          <li>
            <strong className="font-semibold text-text-primary">Disputes.</strong> When a
            match result is contested: which side contested it, the files uploaded as
            evidence, their description, and the notes written by the admin who settled it.
          </li>
          <li>
            <strong className="font-semibold text-text-primary">Social activity.</strong>{' '}
            Friend requests and friendships, the accounts you have blocked, the private
            messages you exchange, and the notifications the platform generated for you.
          </li>
          <li>
            <strong className="font-semibold text-text-primary">Technical data.</strong> One
            session cookie (see §6), the fact that you are connected right now — held in
            memory, in Redis, and erased the moment you disconnect — and the server logs of
            the requests made to the API.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="never" title="3. What we never collect">
        <p>
          This is not a promise of good behaviour, it is a description of the code: none of
          the following exists in the project.
        </p>
        <LegalList>
          <li>No advertising, and no advertising identifier.</li>
          <li>
            No analytics, no audience measurement, no third-party script loaded on the page.
          </li>
          <li>
            No tracking cookie. The platform sets exactly one cookie, and it only keeps you
            signed in.
          </li>
          <li>No location data, no address book, no device fingerprint.</li>
          <li>
            No profiling and no automated decision about you — the only automatic decisions
            the platform makes are the two 24-hour clocks of §7, and they are about match
            results, not about people.
          </li>
          <li>
            Your data is never sold, rented, shared with a partner or transferred to a third
            party. There is no third party.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="why" title="4. Why we store it">
        <p>
          Each piece of data above exists because a feature needs it, and it is used for
          nothing else:
        </p>
        <LegalList>
          <li>
            <strong className="font-semibold text-text-primary">Running your account</strong> —
            signing you in, keeping you signed in, and letting you change your details.
          </li>
          <li>
            <strong className="font-semibold text-text-primary">
              Making competition possible
            </strong>{' '}
            — an opponent has to be able to see who accepted their challenge, which players
            are fielded against them, and where everyone stands in the ladder.
          </li>
          <li>
            <strong className="font-semibold text-text-primary">Settling disagreements</strong>{' '}
            — when two sides report different winners, the evidence and the match record are
            what an admin arbitrates on.
          </li>
          <li>
            <strong className="font-semibold text-text-primary">Talking to each other</strong> —
            friends, private messages and notifications.
          </li>
          <li>
            <strong className="font-semibold text-text-primary">Protecting the service</strong>{' '}
            — password hashing, optional two-factor authentication, and rate limits that stop
            an endpoint from being hammered.
          </li>
        </LegalList>
        <p>
          The legal basis is the performance of the service you asked for when you created an
          account, plus our legitimate interest in keeping that service secure and its
          rankings honest. The optional items — avatar, bio, 2FA, linked accounts, Google
          sign-in — rest on your consent, which you withdraw by removing them.
        </p>
      </LegalSection>

      <LegalSection id="visibility" title="5. Who can see what">
        <LegalList>
          <li>
            <strong className="font-semibold text-text-primary">
              Visible to any signed-in player
            </strong>{' '}
            on your player page: your pseudo, your display name, your avatar, your bio, the
            teams you belong to, and for each ladder your Elo, your rank and your win–loss
            record. Competitive standings are public by nature — that is the point of a
            ladder.
          </li>
          <li>
            <strong className="font-semibold text-text-primary">Visible only to you:</strong>{' '}
            your email address, your linked game accounts and your match history. This is a
            deliberate decision — someone else&apos;s profile shows their standings, never
            what they play or who they played. You see all of it on your own profile.
          </li>
          <li>
            <strong className="font-semibold text-text-primary">Private messages</strong> are
            readable by you and by the person you are talking to, and by nobody else in the
            app. They are stored in plain text in the database, so whoever administers that
            database could technically read them: treat the chat as a conversation, not as a
            safe.
          </li>
          <li>
            <strong className="font-semibold text-text-primary">Dispute evidence</strong> is
            visible to the players involved in that match and to the admins who arbitrate it.
            The files live in a private bucket and are never served publicly.
          </li>
          <li>
            <strong className="font-semibold text-text-primary">Blocking is silent.</strong> If
            you block someone, they are never told. You simply stop existing for each other: no
            conversation, no profile, no search result, and the platform answers
            &laquo;&nbsp;not found&nbsp;&raquo; on both sides — the same answer it gives for an
            account that never existed.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="cookies" title="6. Cookies and sessions">
        <p>
          The platform sets <strong className="font-semibold text-text-primary">one</strong>{' '}
          cookie, named <code className="text-text-primary">refresh</code>. It holds the token
          that lets your browser get a fresh session without typing your password again. It is{' '}
          <code className="text-text-primary">HttpOnly</code> (no script can read it),{' '}
          <code className="text-text-primary">Secure</code> (it only travels over HTTPS),{' '}
          <code className="text-text-primary">SameSite=Strict</code> (it is never sent from
          another site), it is restricted to the authentication routes, and it expires after
          seven days.
        </p>
        <p>
          The short-lived token used for every other request is kept in the memory of the tab
          only. Closing the tab loses it; nothing of it is written to your disk. Signing out —
          or deleting your account — clears the cookie immediately.
        </p>
        <p>
          There is no third-party cookie, no consent banner, and nothing to opt out of, because
          there is nothing else to store.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="7. How long we keep it">
        <LegalList>
          <li>Everything attached to your account is kept for as long as the account exists.</li>
          <li>
            The fact that you are connected disappears the second the connection closes. It is
            never written to disk.
          </li>
          <li>
            A challenge slot nobody accepted expires on its own and is cleaned up by a job that
            runs regularly.
          </li>
          <li>
            Two automatic clocks run at 24 hours: a match whose score only one side reported is
            validated on that score, and a dispute no admin has settled is cancelled, sending
            the match back to its previous state. Both are announced on the match page when
            they apply.
          </li>
          <li>Deleting your account erases the rest immediately — see the next section.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="deletion" title="8. Deleting your account">
        <p>
          You can delete your account yourself, from your profile page, by confirming with your
          password and — if you enabled it — a two-factor code. Two conditions have to be met
          first, and the app tells you which one is blocking: you must have{' '}
          <strong className="font-semibold text-text-primary">no ongoing match</strong>, and if
          you are the captain of a team you must{' '}
          <strong className="font-semibold text-text-primary">dissolve it first</strong>.
          Leaving mid-match would strand an opponent with a fixture they can neither play nor
          close.
        </p>
        <p>Deletion is immediate and final. Erased on the spot:</p>
        <LegalList>
          <li>your profile, email address, password hash and two-factor secret;</li>
          <li>your avatar file, deleted from storage;</li>
          <li>your linked game accounts;</li>
          <li>your friendships, friend requests and blocks;</li>
          <li>
            every private message you sent <em>and</em> received — they disappear for your
            correspondents too;
          </li>
          <li>your notifications;</li>
          <li>your presence in the line-ups of past matches.</li>
        </LegalList>
        <p>
          What remains: matches that were already played keep their score, their winner and the
          Elo they moved. They belong to your opponents&apos; history as much as to yours, and
          erasing them would rewrite other people&apos;s rankings — but your name no longer
          appears anywhere in them. There is no restore and no grace period; we cannot bring an
          account back.
        </p>
      </LegalSection>

      <LegalSection id="rights" title="9. Your rights">
        <p>
          Under the GDPR you have the right to access your data, to correct it, to erase it, to
          restrict or object to its use, and to receive it in a portable form. In practice:
        </p>
        <LegalList>
          <li>
            <strong className="font-semibold text-text-primary">Access</strong> — everything we
            hold about you is already on screen: your profile, your match history, your
            conversations, your notifications, your disputes.
          </li>
          <li>
            <strong className="font-semibold text-text-primary">Correction</strong> — your
            profile page edits your display name, bio, avatar, email and password.
          </li>
          <li>
            <strong className="font-semibold text-text-primary">Erasure</strong> — the delete
            button on that same page, described in §8.
          </li>
          <li>
            <strong className="font-semibold text-text-primary">
              Anything else, including a copy of your data
            </strong>{' '}
            — write to any of the addresses at the bottom of this page. We answer as four
            students, not as a support desk, but we do answer.
          </li>
        </LegalList>
        <p>
          If you think we have mishandled your data, you may lodge a complaint with the CNIL,
          the French data protection authority.
        </p>
      </LegalSection>

      <LegalSection id="security" title="10. How we protect it">
        <LegalList>
          <li>The whole site is served over HTTPS; the API accepts nothing else.</li>
          <li>Passwords are stored as bcrypt hashes, and are never logged nor mailed.</li>
          <li>Sessions use short-lived signed tokens plus the strict cookie of §6.</li>
          <li>Two-factor authentication is available on every account with a password.</li>
          <li>Sensitive endpoints are rate-limited.</li>
          <li>
            Avatars and team logos are images of at most 2 MB (PNG, JPEG or WebP); dispute
            evidence may also be a PDF, up to 5 MB, and is stored in a bucket that is not
            publicly readable.
          </li>
          <li>Every input is validated on the server, not only in the browser.</li>
        </LegalList>
        <p>
          That said, be realistic about what this is: a student project, written to be graded,
          hosted on school infrastructure, without a security team behind it. Use a password
          you use nowhere else, and do not put anything here you would mind losing or seeing.
        </p>
      </LegalSection>

      <LegalSection id="minors" title="11. Age requirement">
        <p>
          VSMODE is intended for students of 42 and the people they invite. You must be at
          least 15 years old to create an account — the age at which French law lets you
          consent on your own to a service like this one. If we find out that a younger child
          registered without a parent&apos;s consent, we delete the account.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="12. Changes to this policy">
        <p>
          If the platform changes what it stores, this page changes with it and the date at the
          top is updated. Because this is a school project, every previous version of this text
          is kept in the project&apos;s Git history — there is nothing to hide and nothing that
          silently rewrites itself.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="13. Contact">
        <p>
          For any question about this policy, about the data we hold on you, or to exercise one
          of the rights in §9, write to any of us:
        </p>
        <MaintainerList />
        <p>
          The rules for using the platform are in the{' '}
          <Link
            to="/terms"
            className="rounded-control text-text-primary underline underline-offset-4 transition hover:opacity-90 focus-ring focus-visible:outline-offset-4"
          >
            Terms of Service
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}

export default Privacy;
