// Every open slot of every ladder, and the only place in the app where one can be accepted.
// `?ladderId=<uuid>` narrows the board down to a single ladder.
// The server decides who may accept what and returns the reason when it refuses, so the accept
// button only reads that verdict instead of re-checking the rules here.

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

export function Matchmaking() {
  const navigate = useNavigate();
  const uid = useId();
  const { ladderId: requestedLadderId } = useSearch({ from: '/_authenticated/matchmaking' });

  const [filtersTouched, setFiltersTouched] = useState(false);

  // the 3 filters, `undefined` here does NOT mean "no filter" — it means "the user has not
  // touched this control yet" and an incoming `?ladderId=` then supplies the value.
  const [pickedGameId, setPickedGameId] = useState<string>();
  const [pickedFormat, setPickedFormat] = useState<SlotFormat>();
  const [acceptableOnly, setAcceptableOnly] = useState(true); // 'Only slots i can accept'

  // which slot did you select? (for the ACCEPT for a team match)
  const [lineupSlotId, setLineupSlotId] = useState<string | null>(null);
  const [soloSlot, setSoloSlot] = useState<OpenSlot | null>(null);

  // You click Accept on a slot, and the server says 409 — someone else already took it, or it
  // just crossed its 15-minute deadline.
  const [boardNotice, setBoardNotice] = useState<string | null>(null);

  const acceptButtonRef = useRef<HTMLButtonElement>(null);
  // lol accessiblity: where does the keyboard cursor go when the thing that had focus gets destroyed?
  const listHeadingRef = useRef<HTMLHeadingElement>(null);

  const announcement = useAnnouncement();

  const { games, isError: gamesFailed } = useSortedGames();
  const laddersQuery = useLadders();
  const myTeamsQuery = useMyTeams();

  const ladders = laddersQuery.data?.ladders;
  const requestedLadder = requestedLadderId
    ? ladders?.find((ladder) => ladder.id === requestedLadderId)
    : undefined;

  // Unknown id, or a ladder list that failed eg:
  // https://localhost:5173/matchmaking?ladderId=00000000-0000-4000-8000-000000000000
  const ladderFilterDropped =
    Boolean(requestedLadderId) && ladders !== undefined && !requestedLadder;
  const ladderFilterUnknown = Boolean(requestedLadderId) && laddersQuery.isError;

  /** AN INCOMING `?ladderId=` IS TRANSLATED INTO THE TWO VISIBLE CONTROLS */
  // `ladder.format` is a plain `string`: narrow it w/ `SLOT_FORMATS.find` the Format select already uses
  const ladderFormat = SLOT_FORMATS.find((value) => value === requestedLadder?.format);
  const gameId = filtersTouched ? pickedGameId : (requestedLadder?.gameId ?? pickedGameId);
  const format = filtersTouched ? pickedFormat : (ladderFormat ?? pickedFormat);

  /** Which formats a given game actually has a ladder for. */
  const formatsFor = (game: string | undefined): readonly SlotFormat[] => {
    if (!ladders) return SLOT_FORMATS;
    const pool = game ? ladders.filter((ladder) => ladder.gameId === game) : ladders;
    const present = new Set(pool.map((ladder) => ladder.format));
    return SLOT_FORMATS.filter((value) => present.has(value));
  };
  const availableFormats = formatsFor(gameId);

  const filters = { gameId, format, acceptableOnly };

  /** The first touch also drops `?ladderId=` from the URL. */
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

  /** The instant the board judges its own rows against. */
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

  /** A REFUSAL DESCRIBES ONE BOARD, AND ONLY THAT ONE. */
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
    // names the list, instead of dropping a keyboard user back onto <body>.
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
      // No `lineup` key at all in 1v1 — the player IS the side, and `apiFetch` must not
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

  ///////////////////////////// - return - ///////////////////////////////

  return (
    <div className="panel flex min-w-0 flex-col gap-5 p-6">
      <header className="space-y-1">
        <p className="flex items-center gap-2 text-xs label-caps text-success">
          <Swords aria-hidden="true" className="size-4" /> Matchmaking
        </p>
        <h1 className="text-3xl label-caps-black">Open slots</h1>
        <p className="max-w-prose pt-1 text-sm text-text-secondary">
          Every slot waiting for an opponent, soonest first. You will not see who opened one. Take a
          slot and it's yours immediately — no confirmation from the other side, and you play at the
          scheduled time.
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
          // only showing allowed formats for the new game
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
          The list of games could not be loaded, so the Game filter is empty and a refusal cannot
          name the account it wants (« Steam », « Riot »). Reload the page to get them back.
        </Callout>
      )}

      {ladderFilterUnknown && (
        <Callout tone="muted">
          The ladder list could not be loaded, so the board could not be restricted to one ladder —
          every open slot is listed below.
        </Callout>
      )}

      {/* live region */}
      <p role="status" className="sr-only">
        {announcement.message}
      </p>

      {boardNotice && <Callout tone="danger">{boardNotice}</Callout>}

      <SectionTitle headingRef={listHeadingRef}>Slots</SectionTitle>

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
        // Named so it is not just "list" to a screen reader — and so a selector can target THIS
        // list rather than any `<ul>` of the page (the line-up picker renders one too).

        <ul role="list" aria-label="Open slots" className="flex min-w-0 flex-col gap-3">
          {slots.map((slot) => {
            const solo = slot.format === '1v1';
            const team = solo ? undefined : myTeamOn(slot.ladderId);
            const panelOpen = lineupSlotId === slot.id;
            const provider = games.find((game) => game.id === slot.gameId)?.requiredProvider;
            // `!myTeamsQuery.isPending`, NOT `myTeams !== undefined`: the data is undefined
            // while the query LOADS **and** when it FAILS
            const rosterUnreachable = slot.canAccept && !solo && !team && !myTeamsQuery.isPending;
            // below the 15-minute its expired
            const expired = isSlotExpired(slot, boardNowMs);
            const acceptable = slot.canAccept && !expired;

            return (
              <OpenSlotRow
                key={slot.id}
                slot={slot}
                // because this code is crazy, we also display exactly exactly why something is
                // refused eg: if you dont have any team, we will also supply a link because
                // we're nice like that
                refusal={
                  slot.reason
                    ? slotRefusal(slot, slot.reason, {
                        myTeamId: myTeamOn(slot.ladderId)?.id,
                        providerName: provider ? providerLabel(provider) : undefined,
                      })
                    : expired
                      ? EXPIRED_SLOT_REFUSAL
                      : null
                }
                action={
                  rosterUnreachable && !expired ? (
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
        tone="primary"
        pending={acceptSolo.isPending}
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
