import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Bell, MessageCircle, UserPlus, Users, X } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import { AddFriendSlot } from '@/components/social/AddFriendSlot'
import { ChatSlot } from '@/components/social/ChatSlot'
import { ChatWindowStack, type ChatFocusRequest } from '@/components/social/ChatWindowStack'
import { FriendsSlot } from '@/components/social/FriendsSlot'
import { NotificationsSlot } from '@/components/social/NotificationsSlot'
import { Avatar } from '@/components/ui/avatar'
import { IconButton } from '@/components/ui/icon-button'
import { Tabs, type TabItem } from '@/components/ui/tabs'
import { panelId, tabId } from '@/components/ui/tab-ids'
import { useMediaQuery } from '@/hooks/use-media-query'
import { sendErrorMessage } from '@/lib/messages'
import { useNotificationBell } from '@/lib/notifications'
import { realtimeClient } from '@/lib/realtime-client'
import { useAnnouncement } from '@/lib/use-announcement'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import {
  useRealtimeStore,
  type RealtimeConnectionState,
} from '@/stores/realtime-store'

import type { SetStateAction } from 'react'
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
 * closed under it.
 */
const ABANDONED_SEND_WATCH_MS = 10_000

/** HOW MANY CONVERSATIONS CAN BE OPEN AT ONCE, and why these numbers. */
const FLOATING_QUERY = '(min-width: 1024px)'
const TWO_WINDOWS_QUERY = '(min-width: 1280px)'
const THREE_WINDOWS_QUERY = '(min-width: 1600px)'

type SocialPanelProps = {
  onClose?: () => void
}

export function SocialPanel({ onClose }: SocialPanelProps) {
  const [activeTab, setActiveTab] = useState<SocialTabId>('friends')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  /** THE open conversations, oldest first — one source of truth for both layouts. */
  const [openConversations, setOpenConversations] = useState<ChatPartner[]>([])
  /** WHAT IS BEING TYPED, per partner — held here rather than in the conversation itself. */
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  /** WHICH conversation should take the focus, and a counter so asking twice fires twice. */
  const [focusRequest, setFocusRequest] = useState<ChatFocusRequest | null>(null)
  /** Bumped when the LAST window is closed: the focus has to land on something that remains. */
  const [tabFocusRequests, setTabFocusRequests] = useState(0)
  const notificationsRef = useRef<HTMLDivElement>(null)
  /** The bell itself: where the focus goes back when its panel is closed under it. */
  const bellRef = useRef<HTMLButtonElement>(null)
  /** Was the focus INSIDE the popover when it was closed? */
  const restoreBellFocusRef = useRef(false)
  const tabsId = useId()
  const isFloating = useMediaQuery(FLOATING_QUERY)
  const fitsTwoWindows = useMediaQuery(TWO_WINDOWS_QUERY)
  const fitsThreeWindows = useMediaQuery(THREE_WINDOWS_QUERY)
  const maxWindows = !isFloating ? 1 : fitsThreeWindows ? 3 : fitsTwoWindows ? 2 : 1
  const user = useAuthStore((state) => state.user)
  const connectionState = useRealtimeStore((state) => state.connectionState)
  /**
   * THE ONE PLACE THIS HOOK MAY BE CALLED. It owns the live subscription that keeps the badge
   * exact, so a second copy would count every incoming notification twice.
   */
  const unreadCount = useNotificationBell()
  // Destructured: the effect below depends on `announce` alone, and `useAnnouncement` returns a
  // fresh object every render — depending on that object would re-subscribe on every render.
  const { message: announcement, announce } = useAnnouncement()
  const connectionDetails = CONNECTION_DETAILS[connectionState]
  /**
   * Inline mode (under 1024 px) shows exactly ONE conversation: the most recently opened, which
   * is also the only one `openConversation` can have left there, since `maxWindows` is 1.
   */
  const inlineConversation = openConversations.at(-1)
  const displayName = user?.displayName || user?.pseudo || 'Player'
  const fallback = (user?.pseudo ?? '?').slice(0, 2).toUpperCase()
  /** CLOSING THE BELL'S PANEL DESTROYS WHATEVER HAD THE FOCUS INSIDE IT. */
  const closeNotifications = useCallback(() => {
    restoreBellFocusRef.current =
      notificationsRef.current?.contains(document.activeElement) ?? false
    setNotificationsOpen(false)
  }, [])

  useEffect(() => {
    if (notificationsOpen || !restoreBellFocusRef.current) return

    restoreBellFocusRef.current = false
    bellRef.current?.focus()
  }, [notificationsOpen])

  useEffect(() => {
    if (!notificationsOpen) return

    function closeOnOutsideClick(event: PointerEvent) {
      if (!notificationsRef.current?.contains(event.target as Node)) {
        closeNotifications()
      }
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        closeNotifications()
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [closeNotifications, notificationsOpen])

  /** Where the focus goes when the LAST conversation is closed. */
  useEffect(() => {
    if (tabFocusRequests === 0) return

    document.getElementById(tabId(tabsId, 'chat'))?.focus()
  }, [tabFocusRequests, tabsId])

  /** Writes one conversation's draft. */
  const handleDraftChange = useCallback(
    (partnerId: string, value: SetStateAction<string>) => {
      setDrafts((current) => {
        const previous = current[partnerId] ?? ''
        const next = typeof value === 'function' ? value(previous) : value

        // Same text = same object: the composers of the other windows must not re-render
        // because one of them re-applied the value it already had.
        return next === previous ? current : { ...current, [partnerId]: next }
      })
    },
    [],
  )

  /** WHAT CLEARS A DRAFT: the user closing the conversation, and nothing else. */
  const forgetDraft = useCallback((partnerId: string) => {
    setDrafts((current) => {
      if (!(partnerId in current)) return current

      return Object.fromEntries(Object.entries(current).filter(([id]) => id !== partnerId))
    })
  }, [])

  /** A SEND CAN OUTLIVE ITS CONVERSATION. */
  const abandonedSendWatchRef = useRef<number | null>(null)

  const handleSendAbandoned = useCallback(() => {
    abandonedSendWatchRef.current = Date.now() + ABANDONED_SEND_WATCH_MS
  }, [])

  /** WHO ELSE COULD THIS REFUSAL BE FOR. */
  const sendsInFlightRef = useRef(new Set<string>())

  const handleSendInFlightChange = useCallback((partnerId: string, inFlight: boolean) => {
    if (inFlight) sendsInFlightRef.current.add(partnerId)
    else sendsInFlightRef.current.delete(partnerId)
  }, [])

  useEffect(
    () =>
      realtimeClient.subscribe((event) => {
        if (event.type !== 'error') return

        // A mounted conversation is waiting for an answer: it owns this one and displays it in
        // place. The orphan's watch stays armed — a later refusal may still be its own.
        if (sendsInFlightRef.current.size > 0) return

        const watchUntil = abandonedSendWatchRef.current
        // No orphan, or too late to be its answer.
        if (watchUntil === null || Date.now() > watchUntil) return

        abandonedSendWatchRef.current = null
        announce(sendErrorMessage(event.code))
      }),
    [announce],
  )

  function selectTab(tabId: SocialTabId) {
    setActiveTab(tabId)
    closeNotifications()
  }

  function requestFocus(partnerId: string) {
    setFocusRequest((current) => ({ id: partnerId, seq: (current?.seq ?? 0) + 1 }))
  }

  /**
   * Opens — or brings forward — the conversation with one friend. Called by BOTH lists, which
   * is the whole reason it lives up here.
   */
  function openConversation(partner: ChatPartner) {
    setOpenConversations((current) =>
      current.slice(-maxWindows).some((visible) => visible.id === partner.id)
        ? current
        : [...current.filter((open) => open.id !== partner.id), partner].slice(-maxWindows),
    )
    requestFocus(partner.id)
    // Under 1024 px the conversation IS this tab's content, so the tab has to come forward.
    if (!isFloating) setActiveTab('chat')
    closeNotifications()
  }

  /**
   * Closes ONE conversation, independently of the others, and hands the focus over rather than
   * letting the platform drop it on `<body>` when the close button unmounts.
   */
  function closeConversation(partnerId: string) {
    // Functional, like `openConversation`: two closes landing in the same batch would otherwise
    // both start from the list this render captured, and the second would resurrect the first's
    // window.
    setOpenConversations((current) => current.filter((open) => open.id !== partnerId))
    forgetDraft(partnerId)

    // Something is still on screen: the focus goes to it — the newest remaining window on
    // desktop, the conversation that resurfaces in the panel inline.
    const next = openConversations
      .filter((open) => open.id !== partnerId)
      .slice(-maxWindows)
      .at(-1)
    if (next) {
      requestFocus(next.id)
      return
    }

    // Nothing left. Inline (mobile): the list comes back in place and `ChatSlot` parks the
    // focus on its heading — the same landing point it has always used.
    if (!isFloating) return

    setTabFocusRequests((count) => count + 1)
  }

  function toggleNotifications() {
    // Closing with the bell already has the focus in the right place, but it goes through the
    // same door as every other close — one path, so there is only one thing to get right.
    if (notificationsOpen) closeNotifications()
    else setNotificationsOpen(true)
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
      // `focus-ring`, PAS `focus:outline-none`.
      className:
        'min-h-0 flex-1 overflow-y-auto overscroll-contain focus-ring focus-visible:outline-offset-[-2px]',
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">

      <p role="status" className="sr-only">
        {announcement}
      </p>

      <div className="relative flex items-center justify-between gap-3 border-b border-border-subtle p-3">
        <Link
          to="/profile"
          onClick={onClose}
          aria-label="Open my profile"
          className="group focus-ring -m-1 flex w-40 min-w-0 shrink-0 items-center gap-2 rounded-control p-1 transition hover:bg-surface-card-strong"
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

            <IconButton
              ref={bellRef}
              onClick={toggleNotifications}
              className={cn(
                // `relative`: the badge below is positioned against this button, and the
                // wrapper around it is `static` under 1024 px (see the `lg:relative` there).
                'peer relative',
                notificationsOpen && 'bg-surface-card-strong text-text-primary',
              )}
              // THE COUNT IS IN THE NAME, not only in the badge.
              aria-label={
                unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
              }
              aria-haspopup="dialog"
              aria-expanded={notificationsOpen}
              aria-controls={notificationsOpen ? `${tabsId}-notifications-panel` : undefined}
            >
              <Bell className="size-5" aria-hidden="true" />
              {unreadCount > 0 && (
                <span
                  aria-hidden="true"
                  // Capped: past 99 the exact figure stops being information, and a 4-digit
                  // badge would grow wider than the button it sits on.
                  className="absolute right-1 top-1 min-w-4 rounded-full bg-arena-red px-1 text-center text-xs font-bold leading-4 text-background-app"
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </IconButton>

            {notificationsOpen && (
              <div
                id={`${tabsId}-notifications-panel`}
                role="dialog"
                aria-label="Notifications"
                className="absolute inset-x-3 top-full z-30 mt-2 overflow-hidden rounded-control border border-border-subtle bg-surface-card shadow-card lg:left-auto lg:right-0 lg:w-72"
              >
                <NotificationsSlot
                  announce={announce}
                  // Closes the popover AND, under 1024 px, the social overlay around it: a link
                  // that navigates without closing leaves the visitor behind an `aria-modal`
                  // overlay, exactly like the profile link above.
                  onNavigate={() => {
                    closeNotifications()
                    onClose?.()
                  }}
                />
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
          // THE VIEWPORT DECIDES WHERE A CONVERSATION IS SHOWN, not a second piece of state:
          // floating mode hands this tab nothing but the list, inline mode hands it the most
          // recently opened conversation.
          partner={isFloating ? null : (inlineConversation ?? null)}
          onOpen={openConversation}
          onClose={() => {
            if (inlineConversation) closeConversation(inlineConversation.id)
          }}
          announce={announce}
          onNavigate={onClose}
          isVisible={activeTab === 'chat'}
          focusToken={
            !isFloating && inlineConversation && focusRequest?.id === inlineConversation.id
              ? focusRequest.seq
              : 0
          }
          draft={inlineConversation ? (drafts[inlineConversation.id] ?? '') : ''}
          onDraftChange={handleDraftChange}
          onSendAbandoned={handleSendAbandoned}
          onSendInFlightChange={handleSendInFlightChange}
        />
      </div>

      <div {...panelProps('addFriend')}>
        {activeTab === 'addFriend' && (
          <AddFriendSlot announce={announce} onNavigate={onClose} />
        )}
      </div>

      {isFloating && (
        <ChatWindowStack
          conversations={openConversations.slice(-maxWindows)}
          onClose={closeConversation}
          announce={announce}
          focusRequest={focusRequest}
          drafts={drafts}
          onDraftChange={handleDraftChange}
          onSendAbandoned={handleSendAbandoned}
          onSendInFlightChange={handleSendInFlightChange}
        />
      )}
    </div>
  )
}
