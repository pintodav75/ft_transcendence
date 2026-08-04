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
 * closed under it. Same budget as the composer's own net: past it, no answer is coming.
 */
const ABANDONED_SEND_WATCH_MS = 10_000

/**
 * 🔑 HOW MANY CONVERSATIONS CAN BE OPEN AT ONCE, and why these numbers.
 *
 * It is not a taste call, it is what fits. A window is 268 px wide with a 12 px gap between
 * two, the strip starts 340 px from the right edge (312 px social rail + 16 px page padding +
 * 12 px gutter) and the left rail — 264 px wide behind the same 16 px of padding — ends 280 px
 * from the left edge, so the room left for windows is `viewport − 620` px:
 *
 *   1024 px →  404 px of room → 1 window  (2 would need 2×268 + 12 = 548)
 *   1280 px →  660 px         → 2 windows (3 would need 3×268 + 2×12 = 828)
 *   1600 px →  980 px         → 3 windows
 *
 * The tightest of the three is 1280 px, and it still leaves 112 px of daylight between the
 * leftmost window and the left rail.
 *
 * Capped at 3 even on a very wide screen: past that they stop being windows you read and
 * become a wall you close. Under 1024 px the count is 1 and the conversation is not a window
 * at all — it takes over the panel (see `ChatWindowStack` for why).
 *
 * ⚠️ These breakpoints are the ONLY thing keeping a window from running off the left edge, so
 * they must be read back to `ChatWindowStack`'s geometry if either one changes.
 *
 * Written out one by one rather than mapped over a table: `useMediaQuery` is a hook, and a hook
 * called from inside a `.map()` is exactly what the rules of hooks forbid.
 */
const FLOATING_QUERY = '(min-width: 1024px)'
const TWO_WINDOWS_QUERY = '(min-width: 1280px)'
const THREE_WINDOWS_QUERY = '(min-width: 1600px)'

type SocialPanelProps = {
  onClose?: () => void
}

export function SocialPanel({ onClose }: SocialPanelProps) {
  const [activeTab, setActiveTab] = useState<SocialTabId>('friends')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  /**
   * THE open conversations, oldest first — one source of truth for both layouts.
   *
   * It is held HERE and not inside `ChatSlot` because two different tabs open a conversation
   * (the friends list and the Messages list) and, on desktop, the windows are rendered outside
   * the tab panels entirely. Everything that follows from that lives in `openConversation`
   * below: no duplicate, a deterministic order, and an eviction rule.
   *
   * ⚠️ This alone did NOT make a conversation survive a tab switch — the slot was unmounted
   * under it, taking the draft and the realtime buffer with it. What saves those is the panel
   * keeping all three tabs mounted (see the panels below); this state is only the "which ones".
   */
  const [openConversations, setOpenConversations] = useState<ChatPartner[]>([])
  /**
   * WHAT IS BEING TYPED, per partner — held here rather than in the conversation itself.
   *
   * 🚨 A WINDOW THAT LEAVES THE STRIP IS UNMOUNTED, NOT HIDDEN. Narrowing the browser, zooming
   * in one notch, or dropping under 1024 px lowers `maxWindows`, and React destroys whatever no
   * longer renders — with a draft held in the window's own state, a half-typed sentence would
   * simply vanish. This is the same fix [FS-3] made for tab switches, applied to the other door
   * into the same failure.
   *
   * Cleared one entry at a time by `forgetDraft` below — see there for what does and does not
   * count as "done with this conversation".
   */
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  /**
   * WHICH conversation should take the focus, and a counter so asking twice fires twice.
   * Set on every EXPLICIT open, and when closing a window hands the focus to the next one —
   * never on a re-render, a tab switch or a resize, all of which would steal the caret from
   * someone typing somewhere else entirely.
   */
  const [focusRequest, setFocusRequest] = useState<ChatFocusRequest | null>(null)
  /** Bumped when the LAST window is closed: the focus has to land on something that remains. */
  const [tabFocusRequests, setTabFocusRequests] = useState(0)
  const notificationsRef = useRef<HTMLDivElement>(null)
  /** The bell itself: where the focus goes back when its panel is closed under it. */
  const bellRef = useRef<HTMLButtonElement>(null)
  /**
   * Was the focus INSIDE the popover when it was closed? Read at the moment of closing, not in
   * the effect below: by then React has already detached the focused element and the browser
   * has moved the focus to `<body>`, so the question can no longer be asked.
   */
  const restoreBellFocusRef = useRef(false)
  const tabsId = useId()
  const isFloating = useMediaQuery(FLOATING_QUERY)
  const fitsTwoWindows = useMediaQuery(TWO_WINDOWS_QUERY)
  const fitsThreeWindows = useMediaQuery(THREE_WINDOWS_QUERY)
  const maxWindows = !isFloating ? 1 : fitsThreeWindows ? 3 : fitsTwoWindows ? 2 : 1
  const user = useAuthStore((state) => state.user)
  const connectionState = useRealtimeStore((state) => state.connectionState)
  /**
   * 🚨 THE ONE PLACE THIS HOOK MAY BE CALLED. It owns the live subscription that keeps the
   * badge exact, so a second copy would count every incoming notification twice. Anything
   * else that needs the number reads `useUnreadNotificationCount()` — same cache, no listener.
   *
   * It is also the ONLY request the rail makes before the user asks for anything: the list
   * itself is fetched by `NotificationsSlot`, which is not rendered until the bell is opened.
   */
  const unreadCount = useNotificationBell()
  // Destructured: the effect below depends on `announce` alone, and `useAnnouncement` returns
  // a fresh object every render — depending on that object would re-subscribe on every render.
  const { message: announcement, announce } = useAnnouncement()
  const connectionDetails = CONNECTION_DETAILS[connectionState]
  /**
   * Inline mode (under 1024 px) shows exactly ONE conversation: the most recently opened, which
   * is also the only one `openConversation` can have left there, since `maxWindows` is 1.
   *
   * ⚠️ It can hold more than one after a resize DOWN from a wide screen, and that is deliberate
   * rather than tidied away: the others are still open, they are simply not all on screen at
   * once. Closing this one reveals the next, and widening brings the others back on screen.
   *
   * 🔑 WHAT "COMES BACK" IS NOT EVERYTHING, and it is worth being exact. A window that left the
   * strip was UNMOUNTED, so what returns is the conversation and the draft (held above, one per
   * partner) — while its history is re-fetched from the server on the way back, and a send that
   * was still in flight is abandoned, its refusal then reported by the watch further down. The
   * history costs one request and loses nothing; the send is the one thing that is really cut
   * short, which is exactly why it is announced rather than swallowed.
   */
  const inlineConversation = openConversations.at(-1)
  const displayName = user?.displayName || user?.pseudo || 'Player'
  const fallback = (user?.pseudo ?? '?').slice(0, 2).toUpperCase()
  /**
   * 🚨 CLOSING THE BELL'S PANEL DESTROYS WHATEVER HAD THE FOCUS INSIDE IT. Before [FS-2] the
   * popover held nothing focusable, so nobody could be standing in it; now it holds a list of
   * links and "mark as read" buttons, and `Escape` — or a click outside — would drop a keyboard
   * user back on `<body>`, at the top of the page. The bell is the control that opened it, so
   * the bell is where the focus goes back (same rule as `MobileHeader` and its trigger).
   *
   * ⚠️ ONLY when the focus was actually in there. Closing the popover as a side effect of
   * clicking a tab, or of opening a conversation, must not yank the focus away from what the
   * user just aimed at.
   */
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

  /**
   * Where the focus goes when the LAST conversation is closed. Its window is gone, so there is
   * no composer left to hand it to, and the platform would drop it on `<body>` — a keyboard
   * user back at the top of the page.
   *
   * The Messages TAB is the landing point: it is the one control that is always there, it is
   * where these windows are opened and listed, and it names itself on arrival. It is focused
   * WITHOUT being selected — closing a window is not a request to change tab.
   */
  useEffect(() => {
    if (tabFocusRequests === 0) return

    document.getElementById(tabId(tabsId, 'chat'))?.focus()
  }, [tabFocusRequests, tabsId])

  /**
   * Writes one conversation's draft. Given to every window, hence the partner id as first
   * argument: ONE callback with a stable identity serves all three, where a closure built per
   * partner would be a new function on every render — and the conversation depends on this one
   * inside the effect that subscribes to the socket.
   */
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

  /**
   * 🔑 WHAT CLEARS A DRAFT: the user closing the conversation, and nothing else.
   *
   * Everything else that makes a window disappear is the app's own doing — narrowing the
   * viewport, zooming, or the oldest window giving way when a fourth is opened — and taking
   * somebody's half-typed sentence away as a side effect of any of those is exactly the bug
   * this store exists to kill. The cross is the one gesture that means "I am done with this
   * conversation", so it is the one that starts the next visit on a blank composer.
   *
   * The store therefore holds at most one short string per friend addressed in this session,
   * which is nothing, and never a draft for a conversation the user chose to end.
   */
  const forgetDraft = useCallback((partnerId: string) => {
    setDrafts((current) => {
      if (!(partnerId in current)) return current

      return Object.fromEntries(Object.entries(current).filter(([id]) => id !== partnerId))
    })
  }, [])

  /**
   * 🚨 A SEND CAN OUTLIVE ITS CONVERSATION. Closing the window (or letting it drop out of the
   * strip on a resize) while a message is still in flight destroys the only listener there was,
   * and the server's refusal — "you are not friends any more", "you are blocked" — then arrives
   * with nobody to show it: the text is gone and the user is never told why.
   *
   * This panel survives all of that, so the conversation hands it the watch on the way out
   * (`onSendAbandoned`) and the refusal is spoken in the rail's own live region.
   */
  const abandonedSendWatchRef = useRef<number | null>(null)

  const handleSendAbandoned = useCallback(() => {
    abandonedSendWatchRef.current = Date.now() + ABANDONED_SEND_WATCH_MS
  }, [])

  /**
   * 🚨 WHO ELSE COULD THIS REFUSAL BE FOR. The `error` frame names nothing — not the message,
   * not the friend — so "there is an orphan waiting" is NOT enough to claim it: with up to
   * three windows on screen, the refusal of a send made from a window that is still open would
   * be shown there in red AND read out here, twice for one failure, while the real orphan went
   * on waiting.
   *
   * So the panel only speaks for refusals NOBODY MOUNTED can account for. Each conversation
   * registers itself here while it has a send in flight; as long as that set is not empty, one
   * of them will display this refusal in place and the panel keeps quiet.
   *
   * A `Set` of ids rather than a counter: mount and unmount are not guaranteed to pair up once
   * (React 19 runs effects twice in development), and adding an id twice is harmless where
   * incrementing twice would leave the panel mute for good.
   */
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
   *
   * 🚨 NEVER TWICE THE SAME PERSON — but "already open" is not the test, "already ON SCREEN"
   * is. A conversation can be open and out of sight: `maxWindows` drops when the viewport
   * narrows, and a browser zoom is enough (three windows at 1600 px, one Ctrl + and the
   * viewport is 1280 logical px, so only the last two are rendered). Clicking the third in the
   * Messages tab used to do strictly nothing — the guard said "already open", the state came
   * back unchanged, the focus was aimed at a window that is not rendered, and in floating mode
   * the tab does not even change. The only way in became silently inert.
   *
   * So: on screen already → left exactly where it is, it only takes the focus. Moving a VISIBLE
   * window to the front would make the others jump sideways every time somebody clicks a name,
   * and that order has to be stable to be usable. Open but off screen → back to the end of the
   * strip, which is the only thing that can actually show it.
   *
   * 🔑 THE OLDEST GIVES WAY. Past `maxWindows` the strip would run off the left edge of the
   * screen, so the least recently opened conversation closes. Losing the oldest is the least
   * surprising of the available answers: it is the one the user stopped looking at first, and
   * it is one click away in the list, which now has it at the top.
   */
  function openConversation(partner: ChatPartner) {
    setOpenConversations((current) =>
      current.slice(-maxWindows).some((visible) => visible.id === partner.id)
        ? current
        : [...current.filter((open) => open.id !== partner.id), partner].slice(-maxWindows),
    )
    requestFocus(partner.id)
    // Under 1024 px the conversation IS this tab's content, so the tab has to come forward.
    // On desktop it is a floating window: switching tab would only take the friends list away
    // from someone who is probably about to open a second conversation.
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
    // window. The focus below is computed from that same captured list on purpose — it is an
    // intent about what the user is looking at right now, not a piece of state.
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
    // focus on its heading — the same landing point it has used since [FS-3].
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
      // 🚨 `focus-ring`, PAS `focus:outline-none`. Ce panneau porte `tabIndex={0}` — c'est
      // exigé par le motif WAI-ARIA « tabs », pour qu'un contenu non focalisable reste
      // atteignable au clavier. Le supprimer de l'ordre de tabulation n'est donc pas une
      // option ; le laisser SANS anneau en était une pire : on tabulait dessus et le focus
      // disparaissait de l'écran, exactement le défaut corrigé deux fois ailleurs sur ce rail
      // (le garage de focus `sr-only` de FS-1, le retour à la cloche de FS-2).
      // `focus-ring` n'agit qu'au `focus-visible` : un clic souris ne dessine rien.
      // `overscroll-contain` empêche la molette de continuer sur la page quand le panneau
      // atteint sa première ou sa dernière ligne : le rail garde son propre défilement.
      className:
        'min-h-0 flex-1 overflow-y-auto overscroll-contain focus-ring focus-visible:outline-offset-[-2px]',
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
              ref={bellRef}
              onClick={toggleNotifications}
              className={cn(
                // `relative`: the badge below is positioned against this button, and the
                // wrapper around it is `static` under 1024 px (see the `lg:relative` there).
                'peer relative',
                notificationsOpen && 'bg-surface-card-strong text-text-primary',
              )}
              // 🔑 THE COUNT IS IN THE NAME, not only in the badge. The badge is `aria-hidden`
              // (a bare number read out of nowhere says nothing), so this is what tells a
              // screen reader — and voice control — how many are waiting.
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
                  // Closes the popover AND, under 1024 px, the social overlay around it: a
                  // link that navigates without closing leaves the visitor behind an
                  // `aria-modal` overlay, exactly like the profile link above.
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
       * gets the same discipline one level down instead of here — `ChatSlot` is always
       * mounted (that is the point), but the conversation LIST inside it is mounted only
       * while the tab is visible, and a conversation's history only once one is opened. So
       * this panel still asks the server for nothing until the user comes to it.
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
          // 🔑 THE VIEWPORT DECIDES WHERE A CONVERSATION IS SHOWN, not a second piece of state:
          // floating mode hands this tab nothing but the list, inline mode hands it the most
          // recently opened conversation. `openConversations` stays the one model of "what is
          // open" in both — so a window that is out of sight at a narrow width is still open,
          // and comes back as the screen widens.
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

      {/* Same two props, and for the same two reasons, as the friends panel above: one live
          region for the whole rail (this one), and a way to close the mobile overlay before a
          link navigates out from under it. Mounted only while its tab is on screen — the slot
          reads four lists, and the rail is on every authenticated page. */}
      <div {...panelProps('addFriend')}>
        {activeTab === 'addFriend' && (
          <AddFriendSlot announce={announce} onNavigate={onClose} />
        )}
      </div>

      {/* OUTSIDE the tab panels on purpose: a floating window belongs to the screen, not to a
          tab, so it stays readable while the user is on "Friends" or "Add friend" — and it is
          never inside a `hidden` panel, which is what would silently give it a zero-height
          layout. Rendered only in floating mode; see `ChatWindowStack` for why not CSS. */}
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
