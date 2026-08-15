// Public profile of one player, at /players/$pseudo. `ViewerRole` still gates what a STRANGER
// may do to the account (befriend, block).

import { useState } from 'react';
import { Ban, SmilePlus, UserCheck, UserMinus, X } from 'lucide-react';
import { Link, useParams } from '@tanstack/react-router';

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
  usePlayer,
} from '@/lib/player-detail';
// THE MUTATIONS COME FROM THE SOCIAL RAIL'S LAYER, not from a copy of it.
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

      <Link to="/teams" className={buttonClasses('secondary')}>
        My teams
      </Link>
    </ErrorPanel>
  );
}

/**
 * GOING FROM ONE PLAYER TO THE NEXT DOES NOT REMOUNT THIS ROUTE — only the param changes, so
 * React keeps the same component instance and EVERY piece of local state below survives the
 * navigation.
 */
export function PlayerDetail() {
  const { pseudo } = useParams({ from: '/_authenticated/players/$pseudo' });

  return <PlayerProfile key={pseudo.toLowerCase()} pseudo={pseudo} />;
}

function PlayerProfile({ pseudo }: { pseudo: string }) {
  // The signed-in user's ID, not their pseudo: it answers both "is this my own page" and "whose
  // friend request is this".
  const connectedUserId = useAuthStore((state) => state.user?.id);
  // THE live region of this page.
  const announcement = useAnnouncement();
  // Blocking destroys an existing friendship server-side and is not undoable from this page, so
  // it goes through a confirmation.
  const [blockConfirming, setBlockConfirming] = useState(false);
  // Unfriending gets a confirmation for the same reason "Leave team" does: it is one click that
  // undoes a mutual relationship.
  const [unfriendConfirming, setUnfriendConfirming] = useState(false);
  const playerQuery = usePlayer(pseudo);
  const sendFriendRequest = useSendFriendRequest();
  const blockUser = useBlockUser();
  // TWO DIFFERENT HOOKS ON ONE ROUTE. `DELETE /friends/{id}` both unfriends and withdraws a
  // request I sent — the server tells them apart from the row's status.
  const unfriend = useRemoveFriend();
  const cancelRequest = useCancelFriendRequest();
  const rejectRequest = useRejectFriendRequest();

  const friendship = playerQuery.data?.friendship;
  // The mutation writes this marker into the shared query cache, whichever component started
  // the block.
  const blocked = playerQuery.data?.__clientBlocked === true;

  // This guard intentionally precedes the query error guard.
  if (blocked) {
    return (
      <div className="flex flex-col gap-6 py-6">

        <p role="status" className="sr-only">
          {announcement.message}
        </p>
        <PlayerErrorPanel
          title="Player blocked"
          message={`You blocked ${playerQuery.data?.user.displayName ?? playerQuery.data?.user.pseudo ?? pseudo}. You will no longer see each other's profiles or messages, and any friendship between you was removed. You can undo this from the Friends panel, under "Add friend".`}
        />
      </div>
    );
  }

  if (playerQuery.isError) {
    const status = playerQuery.error instanceof ApiError ? playerQuery.error.status : undefined;

    return (
      <div className="flex flex-col gap-6 py-6">
        {status === 404 ? (
          // Wording covers TWO cases on purpose: no such pseudo, and a profile hidden because
          // one of the two accounts blocked the other.
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
  // `null` for every relationship that is not an accepted one, which is what drops the second
  // stat cell rather than dashing it.
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
    // A new attempt supersedes the other action's feedback: "Friend request sent" sitting next
    // to "Blocked" leaves the visitor unsure which one just happened.
    blockUser.reset();
    announcement.reset();

    sendFriendRequest.mutate(target.id, {
      // `outcome`, not the raw payload: `POST /friends` ACCEPTS when the other side had already
      // asked, and the hook reads which of the two happened off `friendship.status`.
      onSuccess: (outcome) => {
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
        announcement.announce(`Friend request to ${name} withdrawn.`);
      },
      onError: (error) => announcement.announce(cancelFriendRequestErrorMessage(error)),
    });
  }

  // Visible feedback DERIVED from the mutations — it holds no state of its own to keep in sync,
  // which is most of the point of moving these onto TanStack Query.
  function actionFeedback(): { tone: CalloutTone; text: string } | null {
    if (sendFriendRequest.isError) {
      return { tone: 'danger', text: sendFriendRequestErrorMessage(sendFriendRequest.error) };
    }
    // The withdraw has no dialog of its own, so this is where its failure surfaces. Its sibling
    // `unfriend` is absent for the opposite reason — it reports inside its dialog.
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
    // NO "is now blocked" LINE HERE, and its absence is the whole point: a successful block
    // replaces the page (see `blocked`), so this callout would only ever have said it beside an
    // "Add friend" button offering to befriend the person just blocked.

    return null;
  }

  // Actions on SOMEONE ELSE'S account — a friend included, since a friend can still be blocked.
  // Empty for the owner: this page is read-only, editing lives at /profile.
  function relationshipActions() {
    if (!canInteract) return null;

    return (
      <>

        {cta === 'add' && (
          <Button disabled={acting} onClick={() => handleSendFriendRequest(user)}>
            <SmilePlus aria-hidden="true" className="mr-2 size-4" />
            Add friend
          </Button>
        )}

        {cta === 'accept' && (
          <Button disabled={acting} onClick={() => handleSendFriendRequest(user)}>
            <UserCheck aria-hidden="true" className="mr-2 size-4" />
            Accept request
          </Button>
        )}

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

        <Button variant="secondary" disabled={acting} onClick={() => setBlockConfirming(true)}>
          <Ban aria-hidden="true" className="mr-2 size-4 text-arena-red" />
          Block
        </Button>
      </>
    );
  }

  const feedback = actionFeedback();
  // `?.trim()` and not just a null check: `bio` is a free-text column, so " " is a value the
  // API will happily store and the page must still treat as "nothing written".
  const bio = user.bio?.trim();

  return (
    <div className="flex min-w-0 flex-col gap-6 py-6">

      <BackButton />

      <PlayerHero
        user={user}
        name={name}
        joinedOn={joinedOn}
        friendsSince={friendsSince}
        isFriend={role === ViewerRole.Friend}
        actions={relationshipActions()}
      />

      <p role="status" className="sr-only">
        {announcement.message}
      </p>

      {feedback && <Callout tone={feedback.tone}>{feedback.text}</Callout>}

      <section className="flex flex-col gap-3.5">
        <SectionTitle>Bio</SectionTitle>
        <div className="panel p-4">
          {bio ? (
            // `whitespace-pre-line`: the field accepts newlines and losing them collapsed every
            // multi-line bio into one paragraph.
            <p className="whitespace-pre-line text-sm text-text-secondary">{bio}</p>
          ) : (
            // `text-text-secondary`, not `text-text-muted`: muted on a card measures 4,23:1,
            // under AA, and is already a known debt — no reason to add a 46th usage to it
            // here.
            <p className="text-sm text-text-secondary">{name} has not written a bio yet.</p>
          )}
        </div>
      </section>

      <PlayerRankings rankings={rankings} name={name} />
      <PlayerTeams teams={teams} name={name} />

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
