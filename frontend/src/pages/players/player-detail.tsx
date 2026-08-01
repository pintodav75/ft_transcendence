// Public profile of one player, at /players/$pseudo.
// `ViewerRole` still gates what a STRANGER may do to the account (befriend, block).

import { useState } from 'react';
import { Ban, SmilePlus, UserCheck, UserMinus, X } from 'lucide-react';
import { Link, useParams } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';

import { BackButton } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorPanel } from '@/components/ui/error-panel';
import { PlayerHero } from '@/components/players/PlayerHero';
import { PlayerRankings } from '@/components/players/PlayerRankings';
import { PlayerTeams } from '@/components/players/PlayerTeams';
import { SectionTitle } from '@/components/ui/section-title';
import { buttonClasses } from '@/components/ui/button-variants';
import { ApiError } from '@/lib/api';
import { useAnnouncement } from '@/lib/use-announcement';
import { useAuthStore } from '@/stores/auth-store';
import {
  ViewerRole,
  formatFriendsSince,
  formatJoinDate,
  friendCta,
  getViewerRole,
  playerQueryKey,
  usePlayer,
} from '@/lib/player-detail';
// 🔑 THE MUTATIONS COME FROM THE SOCIAL RAIL'S LAYER, not from a copy of it. Every one of
// these acts changes a list the rail is showing one column away — friends, sent requests,
// received requests, blocked players — and these hooks are the only place that knows which.
// Only the WORDS stay page-specific, in `lib/player-mutations.ts`.
import {
  useBlockUser,
  useCancelFriendRequest,
  useRejectFriendRequest,
  useRemoveFriend,
  useSendFriendRequest,
} from '@/lib/friend-mutations';
import {
  blockUserErrorMessage,
  cancelFriendRequestErrorMessage,
  rejectFriendRequestErrorMessage,
  removeFriendshipErrorMessage,
  sendFriendRequestErrorMessage,
} from '@/lib/player-mutations';

import type { CalloutTone } from '@/components/ui/callout';
import type { Friendship, PublicUser } from '@/lib/player-detail';

// Both dead ends of this page, one component: only the words differ.
function PlayerErrorPanel({ title, message }: { title: string; message: string }) {
  return (
    <ErrorPanel title={title} message={message}>
      {/* This page is reached from a roster chip, a ladder row, a line-up or the search bar,
          so there is no one page it "came from". `/teams` is the same neutral anchor the team
          page's own dead ends use. */}
      <Link to="/teams" className={buttonClasses('secondary')}>
        My teams
      </Link>
    </ErrorPanel>
  );
}

export function PlayerDetail() {
  const { pseudo } = useParams({ from: '/_authenticated/players/$pseudo' });
  // The signed-in user's ID, not their pseudo: it answers both "is this my own page" and
  // "whose friend request is this". Selector form so the page re-renders on the user, not on
  // every token refresh.
  const connectedUserId = useAuthStore((state) => state.user?.id);
  // THE live region of this page. Both actions report through this one — which is why the
  // `Callout` below deliberately carries no `role="status"`: two regions compete for the
  // reading, and a `[role="status"]` selector picks whichever comes first.
  const announcement = useAnnouncement();
  // Blocking destroys an existing friendship server-side and is not undoable from this page,
  // so it goes through a confirmation. Sending a friend request does not: the worst case is
  // a request the other player declines.
  const [blockConfirming, setBlockConfirming] = useState(false);
  // Unfriending gets a confirmation for the same reason "Leave team" does: it is one click
  // that undoes a mutual relationship. WITHDRAWING a request you sent does not — that is
  // undone by clicking once more.
  const [unfriendConfirming, setUnfriendConfirming] = useState(false);
  // 🚨 SET ONCE THE BLOCK HAS GONE THROUGH, and it ends the page. From that moment
  // `GET /users/{pseudo}` answers 404 TO THE BLOCKER TOO, so there is no version of this
  // profile left to show: every button would be a click towards a 404, and the fiche itself
  // is a snapshot of something the account may no longer look at. The page collapses onto its
  // own dead-end panel instead — no navigation to pick (this page has no parent, see the
  // `BackButton` note below), no refetch of a URL that is now forbidden, and it can name
  // where the block is undone, which a redirect could not.
  const [blocked, setBlocked] = useState(false);

  const queryClient = useQueryClient();
  const playerQuery = usePlayer(pseudo);
  const sendFriendRequest = useSendFriendRequest();
  const blockUser = useBlockUser();
  // ⚠️ TWO DIFFERENT HOOKS ON ONE ROUTE. `DELETE /friends/{id}` both unfriends and withdraws a
  // request I sent — the server tells them apart from the row's status. They stay separate here
  // because they invalidate different lists in the rail (friends vs sent requests), they carry
  // different wording, and one reports inside a dialog while the other reports on the page.
  const unfriend = useRemoveFriend();
  const cancelRequest = useCancelFriendRequest();
  const rejectRequest = useRejectFriendRequest();

  const friendship = playerQuery.data?.friendship;

  /**
   * The profile itself carries the friendship (`GET /users/{pseudo}`), so it is stale after
   * every one of these acts — the rail's hooks refresh the rail, never this page.
   *
   * ⚠️ NOT AFTER A BLOCK: that URL answers 404 from then on, and refetching it would print
   * "Failed to load resource" in the console, which is a project-rejection criterion.
   */
  function refreshProfile() {
    return queryClient.invalidateQueries({ queryKey: playerQueryKey(pseudo) });
  }

  if (playerQuery.isError) {
    const status = playerQuery.error instanceof ApiError ? playerQuery.error.status : undefined;

    return (
      <div className="flex flex-col gap-6 py-6">
        {status === 404 ? (
          // ⚠️ Wording covers TWO cases on purpose: no such pseudo, and a profile hidden
          // because one of the two accounts blocked the other. The API conflates them to
          // protect the blocker, so this copy must not claim the account does not exist.
          <PlayerErrorPanel
            title="Profile not available"
            message="This profile could not be opened."
          />
        ) : (
          <PlayerErrorPanel
            title="Profile unavailable"
            message="This profile could not be loaded. Check your connection and reload the page."
          />
        )}
      </div>
    );
  }

  if (playerQuery.isPending) {
    return (
      <div className="flex flex-col gap-6 py-6">
        {/* Mounted while loading too, like the team page's own back link: it depends on the
            history, not on the profile, so hiding it would take the way out away for exactly
            as long as the request lasts. */}
        <BackButton />
        {/* Same footprint as the loaded header, so the layout does not jump on arrival. */}
        <div
          aria-hidden="true"
          className="h-64 animate-pulse rounded-card border border-border-subtle bg-surface-card"
        />
        <p role="status" className="text-sm text-text-muted">
          Loading the profile…
        </p>
      </div>
    );
  }

  const { user, rankings, teams } = playerQuery.data;
  // Derived HERE and not above the guards: both read the loaded profile's id, which is what
  // makes the identity check immune to a pseudo's casing or a later rename.
  const role = getViewerRole(user.id, connectedUserId, friendship);
  const cta = friendCta(friendship, connectedUserId);
  const name = user.displayName ?? user.pseudo;
  const joinedOn = formatJoinDate(user.createdAt);
  // `null` for every relationship that is not an accepted one, which is what drops the
  // second stat cell rather than dashing it.
  const friendsSince = formatFriendsSince(friendship);
  const acting =
    sendFriendRequest.isPending ||
    blockUser.isPending ||
    unfriend.isPending ||
    cancelRequest.isPending ||
    rejectRequest.isPending;
  // A friend can still block; only the owner has nothing to do here.
  const canInteract = role === ViewerRole.Stranger || role === ViewerRole.Friend;

  function handleSendFriendRequest(target: PublicUser) {
    // A new attempt supersedes the other action's feedback: "Friend request sent" sitting
    // next to "Blocked" leaves the visitor unsure which one just happened.
    blockUser.reset();
    announcement.reset();

    sendFriendRequest.mutate(target.id, {
      // `outcome`, not the raw payload: `POST /friends` ACCEPTS when the other side had
      // already asked, and the hook reads which of the two happened off `friendship.status`.
      onSuccess: (outcome) => {
        refreshProfile();
        announcement.announce(
          outcome === 'auto-accepted'
            ? `You are now friends with ${name}.`
            : `Friend request sent to ${name}.`,
        );
      },
      onError: (error) => announcement.announce(sendFriendRequestErrorMessage(error)),
    });
  }

  function confirmBlock(target: PublicUser) {
    sendFriendRequest.reset();
    announcement.reset();

    // `mutate`, not `mutateAsync`: a rejection lands in `blockUser.error` and is rendered
    // inside the dialog, which stays open — so no promise is left dangling here.
    blockUser.mutate(target.id, {
      onSuccess: () => {
        announcement.announce(`${name} is now blocked. You will no longer see each other.`);
        setBlockConfirming(false);
        // No `refreshProfile()` here — see its docblock. The page stops showing the profile
        // altogether rather than keeping a copy it can never refresh.
        setBlocked(true);
      },
      onError: (error) => announcement.announce(blockUserErrorMessage(error)),
    });
  }

  function dismissBlock() {
    // Clears a failed attempt, so re-opening the dialog does not show the old error.
    blockUser.reset();
    setBlockConfirming(false);
  }

  function confirmUnfriend(relation: Friendship) {
    sendFriendRequest.reset();
    announcement.reset();

    unfriend.mutate(relation.id, {
      onSuccess: () => {
        refreshProfile();
        announcement.announce(`${name} is no longer in your friends.`);
        setUnfriendConfirming(false);
      },
      onError: (error) => announcement.announce(removeFriendshipErrorMessage(error)),
    });
  }

  function dismissUnfriend() {
    unfriend.reset();
    setUnfriendConfirming(false);
  }

  function handleRejectRequest(relation: Friendship) {
    sendFriendRequest.reset();
    announcement.reset();

    rejectRequest.mutate(relation.id, {
      onSuccess: () => {
        refreshProfile();
        announcement.announce(`${name}'s friend request was refused.`);
      },
      onError: (error) => announcement.announce(rejectFriendRequestErrorMessage(error)),
    });
  }

  function handleCancelRequest(relation: Friendship) {
    sendFriendRequest.reset();
    announcement.reset();

    cancelRequest.mutate(relation.id, {
      onSuccess: () => {
        refreshProfile();
        announcement.announce(`Friend request to ${name} withdrawn.`);
      },
      onError: (error) => announcement.announce(cancelFriendRequestErrorMessage(error)),
    });
  }

  // Visible feedback DERIVED from the mutations — it holds no state of its own to keep in
  // sync, which is most of the point of moving these onto TanStack Query. Errors win over
  // successes: a failed retry must not leave the previous success on screen.
  //
  // ⚠️ A BLOCK FAILURE IS ABSENT ON PURPOSE: it is rendered inside the dialog, which stays
  // open on error. Reporting it here too would say the same thing twice, in two places.
  function actionFeedback(): { tone: CalloutTone; text: string } | null {
    if (sendFriendRequest.isError) {
      return { tone: 'danger', text: sendFriendRequestErrorMessage(sendFriendRequest.error) };
    }
    // The withdraw has no dialog of its own, so this is where its failure surfaces. Its
    // sibling `unfriend` is absent for the opposite reason — it reports inside its dialog.
    if (cancelRequest.isError) {
      return { tone: 'danger', text: cancelFriendRequestErrorMessage(cancelRequest.error) };
    }
    if (rejectRequest.isError) {
      return { tone: 'danger', text: rejectFriendRequestErrorMessage(rejectRequest.error) };
    }
    if (sendFriendRequest.isSuccess) {
      return {
        tone: 'success',
        text:
          sendFriendRequest.data === 'auto-accepted'
            ? `You are now friends with ${name}.`
            : `Friend request sent to ${name}.`,
      };
    }
    // ⚠️ NO "is now blocked" LINE HERE, and its absence is the whole point: a successful block
    // replaces the page (see `blocked`), so this callout would only ever have said it beside
    // an "Add friend" button offering to befriend the person just blocked.

    return null;
  }

  // Actions on SOMEONE ELSE'S account — a friend included, since a friend can still be
  // blocked. Empty for the owner: this page is read-only, editing lives at /profile.
  //
  // LABELLED buttons, not the icon-only `IconMenuItem` this page used to carry: that
  // component writes its label in a HOVER TOOLTIP and nowhere else, which is no label at
  // all on a touch screen. Its own docblock scopes it to the right-hand nav rail.
  function relationshipActions() {
    if (!canInteract) return null;

    return (
      <>
        {/* Every one of these is disabled while ANY of them is in flight: they all hit the
            same pair of accounts, and blocking someone mid-friend-request is a race the
            backend would settle in an order nobody chose. */}
        {cta === 'add' && (
          <Button disabled={acting} onClick={() => handleSendFriendRequest(user)}>
            <SmilePlus aria-hidden="true" className="mr-2 size-4" />
            Add friend
          </Button>
        )}

        {/* Same handler and same request as "add" — `POST /friends` accepts by posting
            back. Only the label changes, because offering to "send a friend request" to
            someone who already sent you one is nonsense. */}
        {cta === 'accept' && (
          <Button disabled={acting} onClick={() => handleSendFriendRequest(user)}>
            <UserCheck aria-hidden="true" className="mr-2 size-4" />
            Accept request
          </Button>
        )}

        {/* ⚠️ `POST /friends/{id}/reject`, NOT the DELETE used to withdraw: that one
            answers 400 on a request sent TO me and points here. Same outcome (the row is
            deleted), different authorisation — only the addressee may refuse. No
            confirmation: either of you can ask again. */}
        {cta === 'accept' && friendship && (
          <Button
            variant="secondary"
            disabled={acting}
            onClick={() => handleRejectRequest(friendship)}
          >
            <X aria-hidden="true" className="mr-2 size-4" />
            Refuse
          </Button>
        )}

        {/* `DELETE /friends/{id}` on a pending row I own withdraws it. No confirmation:
            one more click sends it again. */}
        {cta === 'pending' && friendship && (
          <Button
            variant="secondary"
            disabled={acting}
            onClick={() => handleCancelRequest(friendship)}
          >
            <X aria-hidden="true" className="mr-2 size-4" />
            Cancel request
          </Button>
        )}

        {/* Same endpoint as the cancel above, different act — hence the dialog. */}
        {cta === 'none' && friendship && (
          <Button variant="secondary" disabled={acting} onClick={() => setUnfriendConfirming(true)}>
            <UserMinus aria-hidden="true" className="mr-2 size-4" />
            Remove friend
          </Button>
        )}

        {/* ⚠️ `secondary`, NOT the `danger` the team page gives "Leave team". Both are
            destructive, but leaving a team is a member's only exit and belongs in the
            reading path, whereas blocking is a rare escalation — a full-red button as loud
            as "Add friend" on every stranger's profile reads as an invitation. The red
            stays on the icon, which is where it identifies the action without shouting. */}
        <Button variant="secondary" disabled={acting} onClick={() => setBlockConfirming(true)}>
          <Ban aria-hidden="true" className="mr-2 size-4 text-arena-red" />
          Block
        </Button>
      </>
    );
  }

  const feedback = actionFeedback();
  // `?.trim()` and not just a null check: `bio` is a free-text column, so " " is a value
  // the API will happily store and the page must still treat as "nothing written".
  const bio = user.bio?.trim();

  // 🚨 THE PAGE ENDS HERE ONCE THE BLOCK WENT THROUGH. Not a redirect: this page has no parent
  // to go back to, and going back could land on the very list the blocked player has just left.
  // A dead-end panel says what happened, and — unlike a redirect — says where to undo it.
  if (blocked) {
    return (
      <div className="flex flex-col gap-6 py-6">
        {/* The live region STAYS MOUNTED across this switch: unmounting it with the profile
            would drop the "is now blocked" announcement before a screen reader ever read it. */}
        <p role="status" className="sr-only">
          {announcement.message}
        </p>
        <PlayerErrorPanel
          title="Player blocked"
          message={`You blocked ${name}. You will no longer see each other's profiles or messages, and any friendship between you was removed. You can undo this from the Friends panel, under "Add friend".`}
        />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 py-6">
      {/* 🔑 THIS PAGE HAS NO PARENT, which is exactly what `BackButton` was written for: a
          player is reached from a ladder's standings, a solo ladder, a roster chip, a match
          line-up, a history row and the search bar, so there is no one page to hard-code a
          link to — it reads the origin off the history entry instead. `solo.mjs` (S13d) guards
          both its presence and the fact that its label NAMES that origin. */}
      <BackButton />

      <PlayerHero
        user={user}
        name={name}
        joinedOn={joinedOn}
        friendsSince={friendsSince}
        isFriend={role === ViewerRole.Friend}
        actions={relationshipActions()}
      />

      {/* MOUNTED FOR THE WHOLE LIFE OF THE PAGE, only its text changes: a region inserted
          into the DOM together with its content is not reliably announced. `sr-only` is
          absolutely positioned, so an empty region costs no layout. */}
      <p role="status" className="sr-only">
        {announcement.message}
      </p>

      {feedback && <Callout tone={feedback.tone}>{feedback.text}</Callout>}

      <section className="flex flex-col gap-3.5">
        <SectionTitle>Bio</SectionTitle>
        <div className="panel p-4">
          {bio ? (
            // `whitespace-pre-line`: the field accepts newlines and losing them collapsed
            // every multi-line bio into one paragraph.
            <p className="whitespace-pre-line text-sm text-text-secondary">{bio}</p>
          ) : (
            // ⚠️ `text-text-secondary`, not `text-text-muted`: muted on a card measures
            // 4,23:1, under AA, and is already a ticketed debt — no reason to add a 46th
            // usage to it here.
            <p className="text-sm text-text-secondary">{name} has not written a bio yet.</p>
          )}
        </div>
      </section>

      {/* Bio says WHO, rankings say AT WHAT LEVEL, teams say WITH WHOM — the profile answered
          only the first of the three until [F-PLAYER].

          🚨 NEITHER A MATCH HISTORY NOR THE LINKED GAME ACCOUNTS BELONG HERE — product
          decision of 31/07, on privacy grounds: what someone plays and which accounts they own
          are read on THEIR OWN profile, not on a stranger's. They live at `/history` and, for
          the linked accounts, on `/profile` ([F4B]). Do not re-propose them for this page. */}
      <PlayerRankings rankings={rankings} name={name} />
      <PlayerTeams teams={teams} name={name} />

      {/* Mounted for as long as the actions are — closing it by unmounting would leave the
          browser nothing to restore focus to. Gated on the role rather than always mounted:
          an owner reading their own page has no business carrying a hidden "Block this
          player?" heading in their DOM.

          🚨 `canInteract`, NOT `Stranger`. The "Block" button is offered to a FRIEND too — and
          falling out with someone you know is the ordinary reason to block at all — but this
          dialog only existed for strangers, so on a friend's profile the button armed a state
          nobody rendered: one click, nothing on screen, no error, no request. Its wording was
          already written for this case ("any friendship between you is removed"). */}
      {canInteract && (
        <ConfirmDialog
          open={blockConfirming}
          title="Block this player?"
          description={
            <>
              <strong className="text-text-primary">{name}</strong> will no longer be able to see
              your profile or message you, and you will no longer see theirs. Any friendship between
              you is removed — re-adding them means starting a new friend request.
            </>
          }
          confirmLabel="Block player"
          cancelLabel="Keep them"
          pending={blockUser.isPending}
          error={blockUser.isError ? blockUserErrorMessage(blockUser.error) : null}
          onConfirm={() => confirmBlock(user)}
          onCancel={dismissBlock}
        />
      )}

      {/* A second dialog beside the first rather than one multiplexing both: the two texts
          share nothing, and a single instance would have to re-derive which act it is showing
          on every render. Same call as the team page's two dialogs. */}
      {friendship && (
        <ConfirmDialog
          open={unfriendConfirming}
          title="Remove this friend?"
          description={
            <>
              You and <strong className="text-text-primary">{name}</strong> will no longer be
              friends. Either of you can send a new request afterwards.
            </>
          }
          confirmLabel="Remove friend"
          pending={unfriend.isPending}
          error={unfriend.isError ? removeFriendshipErrorMessage(unfriend.error) : null}
          onConfirm={() => confirmUnfriend(friendship)}
          onCancel={dismissUnfriend}
        />
      )}
    </div>
  );
}
