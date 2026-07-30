import { useId, useRef, useState } from 'react';
import { ArrowLeft, CalendarPlus } from 'lucide-react';
import { Link, useParams } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CreateSoloSlotPanel } from '@/components/solo/CreateSoloSlotPanel';
import { ErrorPanel } from '@/components/ui/error-panel';
import { SoloHero } from '@/components/solo/SoloHero';
import { SoloMatches } from '@/components/solo/SoloMatches';
import { SoloOverview } from '@/components/solo/SoloOverview';
import { Tabs } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api';
import { buttonClasses } from '@/components/ui/button-variants';
import { cancelMatchErrorMessage, useCancelMatch } from '@/lib/match-mutations';
import { findUserStanding, isValidLadderId, useLadder, useLadderRankings } from '@/lib/ladders';
import { formatMatchDate } from '@/lib/match-detail';
import { hasLinkedProvider, myMatchesKey, useExternalAccounts, useMyMatches } from '@/lib/solo';
import { panelId, tabId } from '@/components/ui/tab-ids';
import { providerLabel, useSortedGames } from '@/lib/games';
import { useAnnouncement } from '@/lib/use-announcement';
import { useAuthStore } from '@/stores/auth-store';

import type { TabItem } from '@/components/ui/tabs';
import type { SoloMatch } from '@/lib/solo';

/**
 * ⚠️ TWO TABS, AND THERE IS NO THIRD. A team page has a captain-only "Manage" tab because a
 * team has a name, a logo, a roster and a dissolution. A solo ladder has none of those: there
 * is nothing to rename, nothing to upload, nobody to kick and nothing to dissolve. Adding an
 * empty Manage tab "for symmetry" would be a door onto an empty room.
 */
const TABS: TabItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'matches', label: 'Matches' },
];

function BackToSolo() {
  return (
    <Link
      to="/solo"
      className="focus-ring inline-flex items-center gap-2 self-start text-xs label-caps text-text-secondary transition hover:text-text-primary"
    >
      <ArrowLeft className="size-4" />
      Solo ladders
    </Link>
  );
}

function SoloErrorPanel({ title, message }: { title: string; message: string }) {
  return (
    <ErrorPanel title={title} message={message}>
      <Link to="/solo" className={buttonClasses('secondary')}>
        <ArrowLeft aria-hidden="true" className="mr-2 size-4" />
        Back to the solo ladders
      </Link>
    </ErrorPanel>
  );
}

/**
 * `/solo/$ladderId` — my dossier on one 1v1 ladder: standing, neighbours, next slot, history,
 * and the two actions that make the cycle reachable with a mouse (open a slot, cancel it).
 *
 * The mirror of `/teams/$teamId`, with three substitutions the card asked for: my avatar and
 * pseudo instead of the team's identity, my linked-account state instead of the roster, and
 * no Manage tab.
 */
export function SoloLadder() {
  const { ladderId } = useParams({ from: '/_authenticated/solo/$ladderId' });
  const uid = useId();
  const createPanelId = useId();
  const [activeTab, setActiveTab] = useState('overview');
  // The slot opener is a DISCLOSURE, not a modal: this flag drives both the inline panel and
  // the `aria-expanded` of the button that toggles it.
  const [creatingSlot, setCreatingSlot] = useState(false);
  // ISO instant of the slot just opened, so the confirmation can name it. Null = nothing.
  const [openedSlotAt, setOpenedSlotAt] = useState<string | null>(null);
  // Holding the whole match (not just an id) is what lets the confirmation state its date.
  const [slotToCancel, setSlotToCancel] = useState<SoloMatch | null>(null);
  // Focus has to come BACK to the opener when the panel closes; the browser only does that
  // for itself with a native <dialog>.
  const createButtonRef = useRef<HTMLButtonElement>(null);
  // FX-FOCUS — landing points after a cancellation destroys the control that had focus. Same
  // rule as the team page: "the nearest surviving element that NAMES the list". In Matches
  // that is the history region; in Overview the whole "Next match" block goes away, so we
  // fall back on the panel, which its tab names.
  const overviewPanelRef = useRef<HTMLDivElement>(null);
  const matchHistoryRef = useRef<HTMLDivElement>(null);
  // ⚠️ ONE live region for the page, therefore ONE message. Two competing states ("opened"
  // and "cancelled") let the older one win and the region ends up contradicting the banner.
  const slotAnnouncement = useAnnouncement();

  const me = useAuthStore((state) => state.user);

  // Mirrors the backend param schema: a malformed id can only ever come back as a 400, so the
  // error state is rendered without spending a request — and without the red "Failed to load
  // resource" line a 400 would leave in the console. EVERY query below is gated on it,
  // including the account one, which does not even depend on the id.
  const validId = isValidLadderId(ladderId);

  const ladderQuery = useLadder(ladderId, validId);
  // Fired in PARALLEL, not chained behind the ladder: the standings and my history are the
  // bulk of this page, and none of them can answer 4xx on a well-formed id.
  const rankingsQuery = useLadderRankings(validId ? ladderId : undefined);
  const matchesQuery = useMyMatches(ladderId, validId);
  const accountsQuery = useExternalAccounts(validId);

  const cancelSlot = useCancelMatch(myMatchesKey(ladderId));
  const { games } = useSortedGames();

  if (!validId) {
    return (
      <div className="flex flex-col gap-6 py-6">
        <SoloErrorPanel
          title="Invalid ladder link"
          message="This ladder identifier is not a valid id. Check the link you followed, or pick a ladder from the solo list."
        />
      </div>
    );
  }

  if (ladderQuery.isError) {
    const status = ladderQuery.error instanceof ApiError ? ladderQuery.error.status : undefined;

    return (
      <div className="flex flex-col gap-6 py-6">
        {status === 404 ? (
          <SoloErrorPanel
            title="Ladder not found"
            message="No ladder answers to this link. Ladders are seeded with the games, so this one has most likely never existed."
          />
        ) : (
          <SoloErrorPanel
            title="Ladder unavailable"
            message="This ladder could not be loaded. Check your connection and reload the page."
          />
        )}
      </div>
    );
  }

  if (!ladderQuery.data || !me) {
    return (
      <div className="flex flex-col gap-6 py-6">
        <BackToSolo />
        {/* Same footprint as the loaded header so the layout does not jump. */}
        <div
          aria-hidden="true"
          className="h-64 animate-pulse rounded-card border border-border-subtle bg-surface-card"
        />
        {/* THE live region while loading — the announcement region below is not mounted yet,
            so there is still only ever one on screen. */}
        <p role="status" className="text-sm text-text-muted">
          Loading the ladder…
        </p>
      </div>
    );
  }

  const { ladder, game } = ladderQuery.data;

  /**
   * 🚨 A WELL-FORMED ID CAN POINT AT A LADDER THAT DOES NOT BELONG HERE — the card did not
   * cover it. `/solo/<cs2-5v5-id>` is a 200 from the API, so there is no error state to
   * inherit: without this branch the page would render "my dossier" on a 5v5 ladder, offer a
   * solo slot that `validateSide()` would refuse (it demands a team and a line-up there), and
   * highlight a user row on a board that only ranks teams. The FORMAT decides, exactly as it
   * does everywhere else in this codebase.
   */
  if (ladder.format !== '1v1') {
    return (
      <div className="flex flex-col gap-6 py-6">
        <ErrorPanel
          title="Not a solo ladder"
          message={`${ladder.name} is played in ${ladder.format}, so it is a team ladder: you enter it with a squad, not on your own name. Its standings and rules are on the ladder page.`}
        >
          <div className="flex flex-wrap gap-2">
            <Link
              to="/ladders/$ladderId"
              params={{ ladderId }}
              className={buttonClasses('secondary')}
            >
              Open {ladder.name}
            </Link>
            <Link to="/solo" className={buttonClasses('secondary')}>
              <ArrowLeft aria-hidden="true" className="mr-2 size-4" />
              Back to the solo ladders
            </Link>
          </div>
        </ErrorPanel>
      </div>
    );
  }

  const rankings = rankingsQuery.data?.rankings;
  const standing = rankings ? findUserStanding(rankings, me.id) : undefined;
  const gameName = games.find((entry) => entry.id === game.id)?.name ?? game.name;
  const matches = matchesQuery.data?.matches;
  // Three-valued: `undefined` means UNKNOWN, which is not "not linked" — see `hasLinkedProvider`.
  const linked = hasLinkedProvider(accountsQuery.data?.externalAccounts, game.requiredProvider);

  function toggleCreateSlot() {
    // A new attempt supersedes the previous confirmation: leaving "Slot opened for…" on screen
    // next to an open form would leave the user unsure which one it describes.
    setOpenedSlotAt(null);
    slotAnnouncement.reset();
    setCreatingSlot((open) => !open);
  }

  function closeCreateSlot() {
    setCreatingSlot(false);
    createButtonRef.current?.focus();
  }

  function handleSlotCreated(scheduledAt: string) {
    slotAnnouncement.announce(
      `Slot opened for ${formatMatchDate(scheduledAt, 'long')}, now waiting for an opponent.`,
    );
    setOpenedSlotAt(scheduledAt);
    setCreatingSlot(false);
    createButtonRef.current?.focus();
  }

  function confirmCancelSlot() {
    if (!slotToCancel) return;

    // `mutate`, not `mutateAsync`: a rejection lands in `cancelSlot.error` and is rendered
    // inside the dialog, so no promise is left dangling in the handler.
    cancelSlot.mutate(slotToCancel.id, {
      onSuccess: () => {
        slotAnnouncement.announce(
          `Slot of ${formatMatchDate(slotToCancel.scheduledAt, 'long')} cancelled. It stays in the history, marked cancelled.`,
        );
        setSlotToCancel(null);
        // The confirmation may well have been describing the slot just withdrawn.
        setOpenedSlotAt(null);
      },
    });
  }

  function dismissCancelSlot() {
    cancelSlot.reset();
    setSlotToCancel(null);
  }

  /**
   * 🚨 THE BUTTON ONLY EXISTS WHEN THE API WOULD ACCEPT THE REQUEST. `linked !== true` covers
   * BOTH "no account" and "we do not know yet" — a `POST /matches` without a linked account is
   * answered 400 by §5.1, and a 4xx writes a red line in the Chrome console, which is a
   * project-rejection criterion. `LinkedAccountStatus` in the Overview says why it is missing,
   * so its absence is never mute.
   */
  const canOpenSlot = linked === true;

  return (
    <div className="flex min-w-0 flex-col gap-6 py-6">
      <BackToSolo />

      <SoloHero
        gameId={game.id}
        gameName={gameName}
        ladderName={ladder.name}
        format={ladder.format}
        me={me}
        standing={standing}
        ladderSize={rankings?.length ?? 0}
        rankingsPending={rankingsQuery.isPending}
        rankingsError={rankingsQuery.isError}
        actions={
          canOpenSlot ? (
            <Button
              ref={createButtonRef}
              aria-expanded={creatingSlot}
              // Only while the panel exists: pointing at a missing id is invalid ARIA.
              aria-controls={creatingSlot ? createPanelId : undefined}
              onClick={toggleCreateSlot}
            >
              <CalendarPlus aria-hidden="true" className="mr-2 size-4" />
              Open a slot
            </Button>
          ) : null
        }
      />

      {canOpenSlot && creatingSlot && (
        <CreateSoloSlotPanel
          id={createPanelId}
          ladder={ladder}
          providerName={providerLabel(game.requiredProvider)}
          matches={matches}
          matchesFailed={matchesQuery.isError}
          onCreated={handleSlotCreated}
          onClose={closeCreateSlot}
        />
      )}

      {/* The live region is MOUNTED FOR THE WHOLE LIFE OF THE PAGE and only its text changes:
          a region inserted into the DOM together with its content is not reliably announced.
          `sr-only` is `position: absolute`, so an empty region costs no layout — the visible
          banner below is a separate, purely visual element.
          ⚠️ It is the ONLY `role="status"` of this screen (invariant #11): that is why
          `SoloMatches` deliberately does not ask for one on its dispute notice. */}
      <p role="status" className="sr-only">
        {slotAnnouncement.message}
      </p>

      {openedSlotAt && !creatingSlot && (
        // The "Next match" block only ever shows the EARLIEST open slot, so a slot opened
        // later than an existing one changes nothing on screen — this banner is what tells the
        // user his click landed. The row itself appears in the Matches tab.
        <Callout tone="success">
          Slot opened for {formatMatchDate(openedSlotAt, 'long')} — it is now waiting for an
          opponent.
        </Callout>
      )}

      <Tabs
        tabs={TABS}
        active={activeTab}
        onSelect={setActiveTab}
        idPrefix={uid}
        label="Solo ladder sections"
      />

      {/* Every panel stays in the DOM, the inactive one `hidden`: each tab's aria-controls
          then points at an element that really exists. */}
      <div
        ref={overviewPanelRef}
        id={panelId(uid, 'overview')}
        role="tabpanel"
        aria-labelledby={tabId(uid, 'overview')}
        hidden={activeTab !== 'overview'}
        // WAI-ARIA: a panel whose content holds no focusable element would be unreachable
        // right after the tab strip without this.
        tabIndex={0}
        className="focus-ring min-w-0"
      >
        <SoloOverview
          meId={me.id}
          ladderId={ladder.id}
          ladderName={ladder.name}
          gameName={gameName}
          provider={game.requiredProvider}
          linked={linked}
          accountsError={accountsQuery.isError}
          matches={matches}
          matchesError={matchesQuery.isError}
          rankings={rankings}
          standing={standing}
          rankingsPending={rankingsQuery.isPending}
          rankingsError={rankingsQuery.isError}
          onCancelSlot={setSlotToCancel}
        />
      </div>

      <div
        id={panelId(uid, 'matches')}
        role="tabpanel"
        aria-labelledby={tabId(uid, 'matches')}
        hidden={activeTab !== 'matches'}
        tabIndex={0}
        className="focus-ring min-w-0"
      >
        <SoloMatches
          matches={matches}
          isPending={matchesQuery.isPending}
          isError={matchesQuery.isError}
          onCancelSlot={setSlotToCancel}
          historyRef={matchHistoryRef}
        />
      </div>

      {/* Mounted for as long as the page is: closing the dialog by unmounting it would leave
          the browser with nothing to restore focus to. */}
      <ConfirmDialog
        open={slotToCancel !== null}
        title="Cancel this slot?"
        description={
          <>
            The slot of{' '}
            <strong className="text-text-primary">
              {formatMatchDate(slotToCancel?.scheduledAt ?? null, 'long')}
            </strong>{' '}
            will no longer be acceptable by anyone. It stays in the history, marked cancelled —
            you can open another one right away.
          </>
        }
        confirmLabel="Cancel the slot"
        cancelLabel="Keep it"
        pending={cancelSlot.isPending}
        error={cancelSlot.isError ? cancelMatchErrorMessage(cancelSlot.error) : null}
        onConfirm={confirmCancelSlot}
        onCancel={dismissCancelSlot}
        // The Cancel button lives in whichever tab is open, so the landing point follows it.
        returnFocusRef={activeTab === 'matches' ? matchHistoryRef : overviewPanelRef}
      />
    </div>
  );
}
