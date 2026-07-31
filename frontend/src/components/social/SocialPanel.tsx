import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Bell, MessageCircle, UserPlus, Users, X } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import { AddFriendSlot } from '@/components/social/AddFriendSlot'
import { ChatSlot } from '@/components/social/ChatSlot'
import { FriendsSlot } from '@/components/social/FriendsSlot'
import { NotificationsSlot } from '@/components/social/NotificationsSlot'
import { Avatar } from '@/components/ui/avatar'
import { IconButton } from '@/components/ui/icon-button'
import { Tabs, type TabItem } from '@/components/ui/tabs'
import { panelId, tabId } from '@/components/ui/tab-ids'
import { sendErrorMessage } from '@/lib/messages'
import { realtimeClient } from '@/lib/realtime-client'
import { useAnnouncement } from '@/lib/use-announcement'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import {
  useRealtimeStore,
  type RealtimeConnectionState,
} from '@/stores/realtime-store'

import type { ChatPartner } from '@/lib/messages'

type SocialTabId = 'friends' | 'chat' | 'addFriend'

const SOCIAL_TABS: TabItem[] = [
  { id: 'friends', label: 'Friends', icon: <Users className="size-5" aria-hidden="true" /> },
  { id: 'chat', label: 'Messages', icon: <MessageCircle className="size-5" aria-hidden="true" /> },
  { id: 'addFriend', label: 'Add friend', icon: <UserPlus className="size-5" aria-hidden="true" /> },
]

const CONNECTION_DETAILS: Record<
  RealtimeConnectionState,
  { label: string; indicatorClassName: string }
> = {
  connecting: {
    label: 'Offline',
    indicatorClassName: 'bg-text-muted',
  },
  open: {
    label: 'Online',
    indicatorClassName: 'bg-success',
  },
  reconnecting: {
    label: 'Offline',
    indicatorClassName: 'bg-text-muted',
  },
  closed: {
    label: 'Offline',
    indicatorClassName: 'bg-text-muted',
  },
}

/**
 * How long the panel keeps watching for the server's answer to a send whose conversation was
 * closed under it. Same budget as the composer's own net: past it, no answer is coming.
 */
const ABANDONED_SEND_WATCH_MS = 10_000

type SocialPanelProps = {
  onClose?: () => void
}

export function SocialPanel({ onClose }: SocialPanelProps) {
  const [activeTab, setActiveTab] = useState<SocialTabId>('friends')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  /**
   * The ONE open conversation ([FS-3]; the list and the several windows belong to [FS-4]).
   *
   * It is held HERE and not inside `ChatSlot` because the friends list is what opens it, and
   * that list lives in another tab. Re-opening the same friend re-uses the very same
   * conversation instead of stacking a duplicate.
   *
   * ⚠️ This alone did NOT make a conversation survive a tab switch — the slot was unmounted
   * under it, taking the draft and the realtime buffer with it. What saves those is the panel
   * keeping all three tabs mounted (see the panels below); this state is only the "which one".
   */
  const [conversation, setConversation] = useState<ChatPartner | null>(null)
  /**
   * Bumped on every EXPLICIT open request, and nothing else. Opening from the friends list
   * destroys the button that had focus (the row unmounts with the tab), so the focus has to be
   * moved by hand — and it must move ONLY then: keying this on the conversation itself would
   * steal the focus from the tab strip every time someone simply comes back to this tab.
   */
  const [openRequests, setOpenRequests] = useState(0)
  const notificationsRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLInputElement>(null)
  const tabsId = useId()
  const user = useAuthStore((state) => state.user)
  const connectionState = useRealtimeStore((state) => state.connectionState)
  // Destructured: the effect below depends on `announce` alone, and `useAnnouncement` returns
  // a fresh object every render — depending on that object would re-subscribe on every render.
  const { message: announcement, announce } = useAnnouncement()
  const connectionDetails = CONNECTION_DETAILS[connectionState]
  const displayName = user?.displayName || user?.pseudo || 'Player'
  const fallback = (user?.pseudo ?? '?').slice(0, 2).toUpperCase()
  useEffect(() => {
    if (!notificationsOpen) return

    function closeOnOutsideClick(event: PointerEvent) {
      if (!notificationsRef.current?.contains(event.target as Node)) {
        setNotificationsOpen(false)
      }
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setNotificationsOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [notificationsOpen])

  // Runs after the Messages tab has rendered its composer, which is why it is an effect and
  // not a line inside `openConversation`: the field does not exist yet when the click happens.
  useEffect(() => {
    if (openRequests === 0) return

    composerRef.current?.focus()
  }, [openRequests])

  /**
   * 🚨 A SEND CAN OUTLIVE ITS CONVERSATION. Closing the window (or opening another friend's)
   * while a message is still in flight destroys the only listener there was, and the server's
   * refusal — "you are not friends any more", "you are blocked" — then arrives with nobody to
   * show it: the text is gone and the user is never told why.
   *
   * This panel survives all of that, so the conversation hands it the watch on the way out
   * (`onSendAbandoned`) and the refusal is spoken in the rail's own live region.
   */
  const abandonedSendWatchRef = useRef<number | null>(null)

  const handleSendAbandoned = useCallback(() => {
    abandonedSendWatchRef.current = Date.now() + ABANDONED_SEND_WATCH_MS
  }, [])

  useEffect(
    () =>
      realtimeClient.subscribe((event) => {
        if (event.type !== 'error') return

        const watchUntil = abandonedSendWatchRef.current
        // No orphan, or too late to be its answer: a mounted conversation owns this refusal and
        // displays it in place, and saying it here as well would state it twice.
        if (watchUntil === null || Date.now() > watchUntil) return

        abandonedSendWatchRef.current = null
        announce(sendErrorMessage(event.code))
      }),
    [announce],
  )

  function selectTab(tabId: SocialTabId) {
    setActiveTab(tabId)
    setNotificationsOpen(false)
  }

  /**
   * Opens (or brings forward) the conversation with one friend. Called from the friends list.
   *
   * Re-clicking the SAME friend keeps the same conversation — `ChatSlot` keys the component on
   * the partner id — and only brings the tab forward with the focus in the composer. Clicking
   * another friend replaces it.
   */
  function openConversation(partner: ChatPartner) {
    setConversation(partner)
    setOpenRequests((count) => count + 1)
    setActiveTab('chat')
    setNotificationsOpen(false)
  }

  function toggleNotifications() {
    setNotificationsOpen((open) => !open)
  }

  /**
   * The shared attributes of the three tab panels, built here rather than copied three times —
   * and the `hidden` is the whole point: see the block that renders them.
   */
  function panelProps(id: SocialTabId) {
    return {
      id: panelId(tabsId, id),
      role: 'tabpanel' as const,
      'aria-labelledby': tabId(tabsId, id),
      tabIndex: 0,
      hidden: activeTab !== id,
      className: 'min-h-0 flex-1 overflow-y-auto focus:outline-none',
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/**
       * 🚨 THE live region of the WHOLE social rail — ONE for the four tabs, and NO SLOT MAY
       * ADD ANOTHER. This panel is mounted by `AuthenticatedLayout` on every authenticated
       * page, so a region declared inside a slot would be permanent AND concurrent with the
       * one the visited page already declares as "the only one of this screen". Four slots
       * (friends, notifications, chat, requests) each declaring their own would make four
       * regions racing in a 312 px column, and a screen reader gives no guarantee about
       * which one it reads first.
       *
       * A slot that has something to announce takes `announce` as a prop (see `FriendsSlot`)
       * and calls it — it never mounts a `role="status"` / `aria-live` of its own.
       *
       * It sits HERE, at the root and outside the tab panel: a region has to be watched by
       * the screen reader BEFORE its text lands (one inserted with its content is not
       * reliably read), and an action that empties a tab — removing my last friend — would
       * otherwise unmount the announcement before it is spoken.
       */}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <div className="relative flex items-center gap-3 border-b border-border-subtle p-3">
        <Link
          to="/profile"
          onClick={onClose}
          aria-label="Open my profile"
          className="group focus-ring -m-1 flex min-w-0 flex-1 items-center gap-3 rounded-control p-1 transition hover:bg-surface-card-strong"
        >
          <div className="relative shrink-0">
            <Avatar
              src={user?.avatarUrl}
              alt=""
              fallback={fallback}
              className="size-11"
            />
            <span className="sr-only">{connectionDetails.label}</span>
            <span
              aria-hidden="true"
              className={cn(
                'absolute bottom-0 right-0 size-3 rounded-full border-2 border-surface-card',
                connectionDetails.indicatorClassName,
              )}
            />
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-text-primary">{displayName}</p>
            <div className="relative h-4 overflow-hidden">
              <p
                className="truncate text-xs text-text-secondary transition duration-200 group-hover:-translate-y-full group-hover:opacity-0 group-focus-visible:-translate-y-full group-focus-visible:opacity-0 motion-reduce:transition-none"
              >
                {connectionDetails.label}
              </p>
              <p
                className="absolute inset-0 translate-y-full truncate text-xs font-medium text-text-primary opacity-0 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-reduce:transition-none"
                aria-hidden="true"
              >
                View profile
              </p>
            </div>
          </div>
        </Link>

        <div className="flex items-center gap-1">
          <div ref={notificationsRef} className="group static lg:relative">
            {/* `peer` stays in `className`: the tooltip below is a sibling that reacts to this
                button's focus, and that is the one thing `IconButton` cannot own for it. */}
            <IconButton
              onClick={toggleNotifications}
              className={cn(
                'peer',
                notificationsOpen && 'bg-surface-card-strong text-text-primary',
              )}
              aria-label="Notifications"
              aria-haspopup="dialog"
              aria-expanded={notificationsOpen}
              aria-controls={notificationsOpen ? `${tabsId}-notifications-panel` : undefined}
            >
              <Bell className="size-5" aria-hidden="true" />
            </IconButton>

            {notificationsOpen && (
              <div
                id={`${tabsId}-notifications-panel`}
                role="dialog"
                aria-label="Notifications"
                className="absolute inset-x-3 top-full z-30 mt-2 overflow-hidden rounded-control border border-border-subtle bg-surface-card shadow-card lg:left-auto lg:right-0 lg:w-72"
              >
                <NotificationsSlot />
              </div>
            )}

            {!notificationsOpen && (
              <span
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute z-20 whitespace-nowrap rounded-control border border-border-subtle bg-surface-card-strong px-2 py-1 text-sm font-medium text-text-primary opacity-0 shadow-card transition-opacity group-hover:opacity-100 peer-focus-visible:opacity-100',
                  'right-0 top-full mt-2 hidden lg:block',
                )}
              >
                Notifications
              </span>
            )}
          </div>

          {onClose && (
            <IconButton onClick={onClose} aria-label="Close social panel">
              <X className="size-5" aria-hidden="true" />
            </IconButton>
          )}

        </div>
      </div>

      <Tabs
        tabs={SOCIAL_TABS}
        active={activeTab}
        onSelect={(id) => selectTab(id as SocialTabId)}
        idPrefix={tabsId}
        label="Social features"
        variant="icon"
      />

      {/**
       * 🚨 THE THREE PANELS ARE ALL RENDERED, and the two inactive ones are `hidden`.
       *
       * `ChatSlot` is the reason. Holding "which conversation is open" up here saved the
       * conversation across a tab switch, but the SLOT was still unmounted — so the draft being
       * typed, every realtime message received since the history was fetched and the send in
       * flight all died for a two-second trip to "Friends", which is about as ordinary as it
       * gets. Kept mounted, it keeps all three.
       *
       * The two other tabs stay CONDITIONAL inside their own panel: mounting them would fire
       * their requests on every authenticated page, since this rail is on all of them. Chat
       * asks for nothing until a conversation is actually opened.
       *
       * ⚠️ A hidden panel is `display: none`, so its content is out of the accessibility tree
       * AND has no layout — `ChatConversation` is told with `isVisible` so it stays quiet in
       * the live region and re-scrolls its log when it comes back.
       */}
      {/* `onClose` travels down for the same reason the profile link above uses it: under
          1024 px this panel is an `aria-modal` overlay, so a link that navigates without
          closing it leaves the visitor behind the overlay. `undefined` on desktop. */}
      <div {...panelProps('friends')}>
        {activeTab === 'friends' && (
          <FriendsSlot
            onNavigate={onClose}
            announce={announce}
            onOpenConversation={openConversation}
          />
        )}
      </div>

      <div {...panelProps('chat')}>
        <ChatSlot
          partner={conversation}
          onClose={() => setConversation(null)}
          announce={announce}
          onNavigate={onClose}
          inputRef={composerRef}
          isVisible={activeTab === 'chat'}
          onSendAbandoned={handleSendAbandoned}
        />
      </div>

      <div {...panelProps('addFriend')}>{activeTab === 'addFriend' && <AddFriendSlot />}</div>
    </div>
  )
}
