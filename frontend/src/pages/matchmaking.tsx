import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Swords } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { AcceptSlotPanel } from '@/components/matchmaking/AcceptSlotPanel';
import { AcceptSlotButton, OpenSlotRow } from '@/components/matchmaking/OpenSlotRow';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SectionTitle } from '@/components/ui/section-title';
import { SlotFilters } from '@/components/matchmaking/SlotFilters';
import { acceptMatchErrorMessage, isSlotGone, useAcceptMatch } from '@/lib/match-mutations';
import { buttonClasses } from '@/components/ui/button-variants';
import { formatMatchDate } from '@/lib/match-detail';
import { providerLabel, useLadders, useSortedGames } from '@/lib/games';
import {
  EXPIRED_SLOT_REFUSAL,
  OPEN_SLOTS_LIMIT,
  SLOT_FORMATS,
  isSlotExpired,
  openSlotsErrorMessage,
  slotRefusal,
  useOpenSlots,
  useSlotClock,
} from '@/lib/matchmaking';
import { useAnnouncement } from '@/lib/use-announcement';
import { useMyTeams } from '@/lib/teams';

import type { OpenSlot, SlotFormat } from '@/lib/matchmaking';

/** Stable id for a row's line-up panel, so `aria-controls` and the panel itself agree. */
function lineupPanelId(uid: string, slotId: string) {
  return `${uid}-lineup-${slotId}`;
}

/**
 * `/matchmaking` — every open slot of every ladder, and the only place in the app where one
 * can be ACCEPTED.
 *
 * 🔑 WHY THIS PAGE EXISTS. The challenge/accept cycle (there is no queue and no matchmaker —
 * a standing product decision) was only half reachable: a slot could be opened from a team
 * page or from `/solo/$ladderId`, and nothing in the UI could take one. `POST
 * /matches/{id}/accept` had never been called by the front at all.
 *
 * 🚨 THE BOARD IS ANONYMOUS AND STAYS ANONYMOUS (B5b). Neither the creating team nor the maps
 * are in the payload: a slot is accepted WITHOUT knowing who opened it, which is what stops
 * opponent-shopping and protects the Elo. A row says game, format, ladder and kick-off — and
 * nothing may ever be added to that list.
 *
 * 🚨 NO BUTTON THE API WOULD REFUSE. `GET /matches` replays the guards of the accept route and
 * answers `canAccept` per slot; a refused slot is still listed, with its reason in plain words
 * and THE LINK THAT FIXES IT — that is what keeps the board from being a dead end. A 4xx
 * provoked by a button would print a red line in the Chrome console, and that is a
 * project-rejection criterion.
 *
 * Sorted soonest first by the server: a slot dies 15 minutes before its own kick-off, so the
 * top of the list is the most perishable thing on the screen.
 */
export function Matchmaking() {
  const navigate = useNavigate();
  const uid = useId();
  const { ladderId: requestedLadderId } = useSearch({ from: '/_authenticated/matchmaking' });

  /**
   * `undefined` here does NOT mean "no filter" — it means "the user has not touched this control
   * yet", and an incoming `?ladderId=` then supplies the value (see `gameId` / `format` below).
   * The two are separated by `filtersTouched` so that choosing "All games" is a real choice and
   * not mistaken for "never chose anything".
   */
  const [pickedGameId, setPickedGameId] = useState<string>();
  const [pickedFormat, setPickedFormat] = useState<SlotFormat>();
  const [filtersTouched, setFiltersTouched] = useState(false);
  // 🚨 TICKED BY DEFAULT: the first question is "what can I play tonight?". Unticking turns the
  // board into "why can I not play?", which is why a refused slot keeps its row and its reason.
  const [acceptableOnly, setAcceptableOnly] = useState(true);

  // The 2v2+ row whose line-up panel is open (one at a time), and the 1v1 slot awaiting its
  // confirmation. Exclusive by construction: a slot is one format or the other.
  const [lineupSlotId, setLineupSlotId] = useState<string | null>(null);
  const [soloSlot, setSoloSlot] = useState<OpenSlot | null>(null);
  /**
   * The one thing the user cannot see happen: his click was refused because the slot had
   * already gone, and the row that carried the message has just been removed by the refetch.
   */
  const [boardNotice, setBoardNotice] = useState<string | null>(null);

  // Focus has to come BACK to the button that opened the panel; the browser only does that for
  // itself, and only for a native <dialog>.
  const acceptButtonRef = useRef<HTMLButtonElement>(null);
  // Landing point when the opener has been destroyed by the refetch (FX-FOCUS): the nearest
  // surviving element that NAMES the list.
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  // ⚠️ THE ONLY `role="status"` OF THIS SCREEN (invariant #11): two live regions fight over the
  // reader, and a `[role=status]` selector taking `.first()` reads whichever it meets.
  const announcement = useAnnouncement();

  const { games, isError: gamesFailed } = useSortedGames();
  const laddersQuery = useLadders();
  // The same cached ['teams'] entry the teams grid reads. It answers two questions no other
  // query can: WHICH team a refusal should link to, and whose roster a 2v2+ acceptance fields.
  const myTeamsQuery = useMyTeams();

  /**
   * `?ladderId=` — a pre-filtered way in for `/ladders/$ladderId`, a team page or
   * `/solo/$ladderId` (posting those links is out of this ticket's scope).
   *
   * 🔑 RESOLVED AGAINST THE CACHED LADDER LIST, NEVER BY ASKING THE API. `GET /matches` answers
   * **404** on a well-formed but unknown `ladderId`, and a 404 writes a red line in the console
   * — a rejection criterion. Same discipline as the game slug of [F-GAMES]: the list is already
   * in cache, so checking the parameter costs nothing and spends no request. (A MALFORMED value
   * never reaches this component: the route's `validateSearch` drops it.)
   */
  const ladders = laddersQuery.data?.ladders;
  const requestedLadder = requestedLadderId
    ? ladders?.find((ladder) => ladder.id === requestedLadderId)
    : undefined;
  // Unknown id, or a ladder list that failed: either way the filter cannot be applied and the
  // board widens to everything — said out loud below rather than done in silence.
  const ladderFilterDropped =
    Boolean(requestedLadderId) && ladders !== undefined && !requestedLadder;
  const ladderFilterUnknown = Boolean(requestedLadderId) && laddersQuery.isError;

  /**
   * 🔑 AN INCOMING `?ladderId=` IS TRANSLATED INTO THE TWO VISIBLE CONTROLS, it is not a third,
   * hidden filter dimension. Arriving from a ladder used to restrict the board while both selects
   * still read "All games / All formats": the screen was filtered and said it was not, and the
   * only way back was a link most people never noticed.
   *
   * 🚨 THIS IS SOUND ONLY BECAUSE A LADDER **IS** THE PAIR (game, format) — enforced in the
   * database by `ladders_game_format_unique`. `?gameId=chess&format=1v1` therefore selects
   * exactly the ladder that was asked for, never one slot more. If that constraint is ever
   * dropped, this translation starts widening the board in silence and has to go back to sending
   * `ladderId` — with the pair shown somewhere the user can clear.
   *
   * The values are DERIVED, not copied by an effect: seeding state once the ladder list lands
   * would cost a render with the wrong board on screen, and a request to go with it.
   */
  // ⚠️ `ladder.format` is a plain `string` in the generated contract: narrowed through the same
  // `SLOT_FORMATS.find` the Format select already uses, so an unknown value falls back to "all
  // formats" instead of being cast into a union it does not belong to.
  const ladderFormat = SLOT_FORMATS.find((value) => value === requestedLadder?.format);
  const gameId = filtersTouched ? pickedGameId : (requestedLadder?.gameId ?? pickedGameId);
  const format = filtersTouched ? pickedFormat : (ladderFormat ?? pickedFormat);

  /**
   * Which formats a given game actually has a ladder for.
   *
   * 🔑 THE FOUR FORMATS OF THE CONTRACT ARE NOT THE FORMATS OF A GAME. Valorant has 2v2 and 5v5
   * and no 1v1; offering "1v1" there hands the reader an empty board and no way to tell "nobody
   * is playing" from "this cannot exist". The ladder list already in cache knows the answer, so
   * the Format select is built from it.
   *
   * ⚠️ Falls back to the FULL list while the ladders are loading or if they failed: hiding
   * options we cannot verify would be a worse lie than showing one combination too many.
   */
  const formatsFor = (game: string | undefined): readonly SlotFormat[] => {
    if (!ladders) return SLOT_FORMATS;
    const pool = game ? ladders.filter((ladder) => ladder.gameId === game) : ladders;
    const present = new Set(pool.map((ladder) => ladder.format));
    return SLOT_FORMATS.filter((value) => present.has(value));
  };
  const availableFormats = formatsFor(gameId);

  const filters = { gameId, format, acceptableOnly };

  /**
   * The first touch also drops `?ladderId=` from the URL. Without it the address bar would keep
   * naming a ladder the user has just filtered away, and a reload would silently undo the change.
   * `replace` so that widening a filter does not add a step to the back button.
   */
  const takeOverFilters = () => {
    if (filtersTouched) return;
    setFiltersTouched(true);
    setPickedGameId(gameId);
    setPickedFormat(format);
    if (requestedLadderId) void navigate({ to: '/matchmaking', search: {}, replace: true });
  };
  // While a `?ladderId=` is still being resolved, firing would send an UNFILTERED request and
  // then a second, filtered one: two round trips and one frame of the wrong board.
  const slotsEnabled = !requestedLadderId || ladders !== undefined || laddersQuery.isError;
  const slotsQuery = useOpenSlots(filters, slotsEnabled);

  const slots = slotsQuery.data?.slots;
  const myTeams = myTeamsQuery.data?.teams;
  const acceptSolo = useAcceptMatch();

  /**
   * The instant the board judges its own rows against.
   *
   * `Math.max` of a ticking clock and the last instant the SERVER certified: the clock is what
   * retires a slot that crosses the 15-minute bound while the tab sits open (`dataUpdatedAt`
   * alone could never disagree with the list it came with), and `dataUpdatedAt` is the floor
   * that keeps a client clock running behind the server from dragging the board backwards.
   */
  const boardNowMs = Math.max(useSlotClock(), slotsQuery.dataUpdatedAt);

  /** My team on a given ladder — `undefined` while `GET /teams` loads, or if it failed. */
  const myTeamOn = (ladderId: string) => myTeams?.find((team) => team.ladderId === ladderId);

  /**
   * A new attempt supersedes the previous refusal, on BOTH paths: leaving "that slot is gone"
   * on screen next to a freshly opened panel would leave the user unsure which slot it
   * describes, and the live region would be contradicting what he can see.
   */
  function startAccept(slot: OpenSlot) {
    setBoardNotice(null);
    announcement.reset();

    if (slot.format === '1v1') {
      acceptSolo.reset();
      setSoloSlot(slot);
      return;
    }

    setLineupSlotId((current) => (current === slot.id ? null : slot.id));
  }

  /**
   * ⚠️ A REFUSAL DESCRIBES ONE BOARD, AND ONLY THAT ONE. « This slot is no longer available »
   * left above a list the user has just re-filtered points at a row that is not there any
   * more — and the live region would still be reading it out. Every filter change clears it,
   * exactly as `startAccept` does.
   */
  function dropBoardNotice() {
    if (boardNotice === null) return;
    setBoardNotice(null);
    announcement.reset();
  }

  function closeLineupPanel() {
    setLineupSlotId(null);
    acceptButtonRef.current?.focus();
  }

  function slotVanished(message: string) {
    setLineupSlotId(null);
    setSoloSlot(null);
    acceptSolo.reset();
    setBoardNotice(message);
    announcement.announce(message);
    // The control that had focus is being removed by the refetch: land on the heading that
    // names the list, instead of dropping a keyboard user back onto <body> (FX-FOCUS).
    listHeadingRef.current?.focus();
  }

  function goToMatch(matchId: string) {
    void navigate({ to: '/matches/$matchId', params: { matchId } });
  }

  function confirmSoloAccept() {
    if (!soloSlot) return;

    // `mutate`, not `mutateAsync`: a rejection lands in `acceptSolo.error` and is rendered
    // inside the dialog, so no promise is left dangling in this handler.
    acceptSolo.mutate(
      // ⚠️ No `lineup` key at all in 1v1 — the player IS the side, and `apiFetch` must not
      // announce a JSON body it is not sending (Fastify answers 400 to exactly that).
      { matchId: soloSlot.id },
      {
        onSuccess: ({ match }) => {
          setSoloSlot(null);
          goToMatch(match.id);
        },
        onError: (error) => {
          // The board is dropping the row behind the dialog: keeping it open would leave a
          // Confirm button aimed at a request the app already knows will be refused again.
          if (isSlotGone(error)) slotVanished(acceptMatchErrorMessage(error, []));
        },
      },
    );
  }

  const count = slots?.length ?? 0;
  /**
   * ⚠️ `limit` IS APPLIED AFTER the acceptability filter, and the route carries neither a
   * cursor nor a total: a full board is truncated IN SILENCE — most easily with the box
   * unticked, where every refused slot of every ladder counts. Saying so is the only honest
   * option; pretending the list is complete is not.
   */
  const truncated = slots !== undefined && count >= OPEN_SLOTS_LIMIT;
  const summary = slotsQuery.isPending
    ? 'Loading the open slots…'
    : slotsQuery.isError
      ? 'The board could not be loaded.'
      : `${count} open slot${count === 1 ? '' : 's'}${acceptableOnly ? ' you can accept' : ''}${
          truncated
            ? ` — only the first ${OPEN_SLOTS_LIMIT} are shown, narrow the filters to see the rest`
            : ''
        }.`;

  return (
    <div className="panel flex min-w-0 flex-col gap-5 p-6">
      <header className="space-y-1">
        <p className="flex items-center gap-2 text-xs label-caps text-success">
          <Swords aria-hidden="true" className="size-4" /> Matchmaking
        </p>
        <h1 className="text-3xl label-caps-black">Open slots</h1>
        <p className="max-w-prose pt-1 text-sm text-text-secondary">
          Every slot waiting for an opponent, soonest first. You will not see who opened one —
          that is deliberate: nobody picks his opponents here. Take a slot and the match starts
          straight away.
        </p>
      </header>

      <SlotFilters
        games={games}
        gameId={gameId}
        format={format}
        formats={availableFormats}
        acceptableOnly={acceptableOnly}
        onGameChange={(value) => {
          dropBoardNotice();
          takeOverFilters();
          setPickedGameId(value);
          // ⚠️ A format the NEW game does not have is dropped, not kept out of sight: leaving
          // "1v1" set while switching to Valorant would empty the board and leave the Format
          // select showing a value it no longer offers.
          const allowed = formatsFor(value);
          setPickedFormat(format && allowed.includes(format) ? format : undefined);
        }}
        onFormatChange={(value) => {
          dropBoardNotice();
          takeOverFilters();
          setPickedFormat(value);
        }}
        onAcceptableOnlyChange={(value) => {
          dropBoardNotice();
          setAcceptableOnly(value);
        }}
      />

      {ladderFilterDropped && (
        <Callout tone="muted">
          That ladder does not exist, so the board was not restricted to it — every open slot is
          listed below.
        </Callout>
      )}

      {gamesFailed && (
        <Callout tone="muted">
          The list of games could not be loaded, so the Game filter is empty and a refusal
          cannot name the account it wants (« Steam », « Riot »). Reload the page to get them
          back.
        </Callout>
      )}

      {ladderFilterUnknown && (
        <Callout tone="muted">
          The ladder list could not be loaded, so the board could not be restricted to one
          ladder — every open slot is listed below.
        </Callout>
      )}

      {/* The live region is MOUNTED FOR THE WHOLE LIFE OF THE PAGE and only its text changes: a
          region inserted into the DOM together with its content is not reliably announced.
          `sr-only` is `position: absolute`, so an empty one costs no layout. It is the ONLY one
          on this screen (invariant #11) — the panel and the dialog deliberately ask for none. */}
      <p role="status" className="sr-only">
        {announcement.message}
      </p>

      {boardNotice && <Callout tone="danger">{boardNotice}</Callout>}

      <SectionTitle headingRef={listHeadingRef}>Slots</SectionTitle>

      {/* A plain paragraph, NOT a second live region: the count is visible, and the list right
          under it is the feedback. */}
      <p className="text-xs text-text-muted">{summary}</p>

      {slotsQuery.isError && (
        <Callout tone="danger">{openSlotsErrorMessage(slotsQuery.error)}</Callout>
      )}

      {slots && count === 0 && (
        <div className="flex flex-col items-start gap-3">
          <p className="max-w-prose text-sm text-text-secondary">
            {acceptableOnly
              ? 'Nothing here you can take right now. Untick the box above to see the slots you cannot accept and why — or open one of your own and let someone come to you.'
              : 'No open slot at all right now. Open one from your team page or from a solo ladder, and it will show up on everyone else’s board.'}
          </p>
          <Link to="/games" className={buttonClasses('secondary')}>
            Browse the games
          </Link>
        </div>
      )}

      {slots && count > 0 && (
        // Named so it is not just "list" to a screen reader — and so a selector can target
        // THIS list rather than any `<ul>` of the page (the line-up picker renders one too).
        <ul role="list" aria-label="Open slots" className="flex min-w-0 flex-col gap-3">
          {slots.map((slot) => {
            const solo = slot.format === '1v1';
            const team = solo ? undefined : myTeamOn(slot.ladderId);
            const panelOpen = lineupSlotId === slot.id;
            const provider = games.find((game) => game.id === slot.gameId)?.requiredProvider;
            // ⚠️ `!myTeamsQuery.isPending`, NOT `myTeams !== undefined`: the data is undefined
            // while the query LOADS **and** when it FAILS, so the second form left the failure
            // case falling through to a permanently greyed-out button with no explanation —
            // this branch was unreachable, which is exactly what the comment used to claim.
            const rosterUnreachable =
              slot.canAccept && !solo && !team && !myTeamsQuery.isPending;
            // 🚨 THE LAST PATH TO A BUTTON THE API WOULD REFUSE. The server only certified this
            // slot as acceptable at the instant it answered; below the 15-minute bound the
            // accept is a 409, and a 409 is a red line in the console.
            const expired = isSlotExpired(slot, boardNowMs);
            const acceptable = slot.canAccept && !expired;

            return (
              <OpenSlotRow
                key={slot.id}
                slot={slot}
                refusal={
                  slot.reason
                    ? slotRefusal(slot, slot.reason, {
                        myTeamId: myTeamOn(slot.ladderId)?.id,
                        providerName: provider ? providerLabel(provider) : undefined,
                      })
                    : // The server's verdict comes first: a slot I could never take says WHY,
                      // and the clock only has the last word on one I otherwise could.
                      expired
                      ? EXPIRED_SLOT_REFUSAL
                      : null
                }
                action={
                  rosterUnreachable && !expired ? (
                    // Saying so beats a button that cannot compose a line-up.
                    <p className="text-sm text-text-secondary">
                      Your teams could not be loaded — reload the page to accept this slot.
                    </p>
                  ) : acceptable ? (
                    <AcceptSlotButton
                      slot={slot}
                      // A 2v2+ acceptance cannot be composed without my roster, and the roster
                      // is reached through my team, which `GET /teams` has not named yet.
                      disabled={!solo && !team}
                      expanded={solo ? undefined : panelOpen}
                      controls={lineupPanelId(uid, slot.id)}
                      // Only the open row's button: it is the one focus must come back to.
                      buttonRef={panelOpen ? acceptButtonRef : undefined}
                      onClick={() => startAccept(slot)}
                    />
                  ) : null
                }
              >
                {panelOpen && team && (
                  <AcceptSlotPanel
                    id={lineupPanelId(uid, slot.id)}
                    slot={slot}
                    teamId={team.id}
                    onAccepted={goToMatch}
                    onVanished={slotVanished}
                    onClose={closeLineupPanel}
                  />
                )}
              </OpenSlotRow>
            );
          })}
        </ul>
      )}

      {/* Mounted for as long as the page is: closing the dialog by unmounting it would leave
          the browser with nothing to restore focus to. */}
      <ConfirmDialog
        open={soloSlot !== null}
        title="Accept this slot?"
        description={
          <>
            The match starts as soon as you accept, on{' '}
            <strong className="text-text-primary">{soloSlot?.ladderName}</strong> at{' '}
            <strong className="text-text-primary">
              {formatMatchDate(soloSlot?.scheduledAt ?? null, 'long')}
            </strong>
            . You will not know who you are playing until then, and any open slot of yours that
            overlaps this one is withdrawn.
          </>
        }
        confirmLabel="Accept the slot"
        cancelLabel="Not this one"
        // `danger` is the component's DEFAULT and it would be wrong here: this dialog
        // destroys nothing, it commits. The red is reserved for kicks and dissolutions.
        tone="primary"
        pending={acceptSolo.isPending}
        // A vanished slot is deliberately NOT shown here: the dialog is closed by
        // `slotVanished` and the news goes to the page, whose banner and live region survive
        // the refetch that is removing the row.
        error={
          acceptSolo.isError && !isSlotGone(acceptSolo.error)
            ? acceptMatchErrorMessage(acceptSolo.error, [])
            : null
        }
        onConfirm={confirmSoloAccept}
        onCancel={() => {
          acceptSolo.reset();
          setSoloSlot(null);
        }}
        returnFocusRef={listHeadingRef}
      />
    </div>
  );
}
