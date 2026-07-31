import { useEffect, useId, useRef, useState } from 'react'
import { Bell, MessageCircle, UserPlus, Users, X } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import { AddFriendSlot } from '@/components/social/AddFriendSlot'
import { ChatSlot } from '@/components/social/ChatSlot'
import { FriendsSlot } from '@/components/social/FriendsSlot'
import { NotificationsSlot } from '@/components/social/NotificationsSlot'
import { Avatar } from '@/components/ui/avatar'
import { Tabs, type TabItem } from '@/components/ui/tabs'
import { panelId, tabId } from '@/components/ui/tab-ids'
import { useAnnouncement } from '@/lib/use-announcement'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import {
  useRealtimeStore,
  type RealtimeConnectionState,
} from '@/stores/realtime-store'

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

type SocialPanelProps = {
  onClose?: () => void
}

export function SocialPanel({ onClose }: SocialPanelProps) {
  const [activeTab, setActiveTab] = useState<SocialTabId>('friends')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const notificationsRef = useRef<HTMLDivElement>(null)
  const tabsId = useId()
  const user = useAuthStore((state) => state.user)
  const connectionState = useRealtimeStore((state) => state.connectionState)
  const outcome = useAnnouncement()
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

  function selectTab(tabId: SocialTabId) {
    setActiveTab(tabId)
    setNotificationsOpen(false)
  }

  function toggleNotifications() {
    setNotificationsOpen((open) => !open)
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
        {outcome.message}
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
            <button
              type="button"
              onClick={toggleNotifications}
              className={cn(
                'peer focus-ring flex size-11 items-center justify-center rounded-control text-text-secondary transition hover:bg-surface-card-strong hover:text-text-primary',
                notificationsOpen && 'bg-surface-card-strong text-text-primary',
              )}
              aria-label="Notifications"
              aria-haspopup="dialog"
              aria-expanded={notificationsOpen}
              aria-controls={notificationsOpen ? `${tabsId}-notifications-panel` : undefined}
            >
              <Bell className="size-5" aria-hidden="true" />
            </button>

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
            <button
              type="button"
              onClick={onClose}
              className="focus-ring flex size-11 items-center justify-center rounded-control text-text-secondary transition hover:bg-surface-card-strong hover:text-text-primary"
              aria-label="Close social panel"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
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

      <div
        id={panelId(tabsId, activeTab)}
        role="tabpanel"
        aria-labelledby={tabId(tabsId, activeTab)}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto focus:outline-none"
      >
        {/* `onClose` travels down for the same reason the profile link above uses it: under
            1024 px this panel is an `aria-modal` overlay, so a link that navigates without
            closing it leaves the visitor behind the overlay. `undefined` on desktop. */}
        {activeTab === 'friends' && (
          <FriendsSlot onNavigate={onClose} announce={outcome.announce} />
        )}
        {activeTab === 'chat' && <ChatSlot />}
        {activeTab === 'addFriend' && <AddFriendSlot />}
      </div>
    </div>
  )
}
