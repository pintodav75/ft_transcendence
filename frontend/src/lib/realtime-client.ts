import { buildWsUrl } from '@/lib/api-config'
import {
  parseRealtimeServerEvent,
  type RealtimeServerEvent,
} from '@/lib/realtime-schema'
import { useRealtimeStore } from '@/stores/realtime-store'

const RECONNECT_BASE_DELAY_MS = 1_000
const RECONNECT_MAX_DELAY_MS = 30_000
const AUTH_POLICY_VIOLATION_CODE = 1008
/**
 * How long a deferred resynchronisation waits for a send to be acknowledged before going ahead
 * anyway.
 */
const RESYNC_SEND_GRACE_MS = 10_000

type EventListener = (event: RealtimeServerEvent) => void

class RealtimeClient {
  private socket: WebSocket | null = null
  private userId: string | null = null
  private accessToken: string | null = null
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private authRejected = false
  private listeners = new Set<EventListener>()
  /**
   * How many sends are still waiting for the server to answer them (`message_sent`, or an
   * `error` frame). Read by `resynchronize()` only — see the comment there.
   */
  private sendsAwaitingAck = 0
  private resyncPending = false
  private resyncGraceTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    window.addEventListener('online', this.handleOnline)
    window.addEventListener('offline', this.handleOffline)
  }

  connect(userId: string, accessToken: string) {
    // The backend validates the JWT only during the WebSocket handshake.
    const sameSession = this.userId === userId
    const socketIsActive =
      this.socket?.readyState === WebSocket.CONNECTING ||
      this.socket?.readyState === WebSocket.OPEN

    if (sameSession && socketIsActive) {
      this.accessToken = accessToken
      return
    }

    const userChanged = this.userId !== null && this.userId !== userId

    this.clearReconnectTimer()
    this.closeCurrentSocket()
    this.userId = userId
    this.accessToken = accessToken
    this.reconnectAttempt = 0
    this.authRejected = false

    if (userChanged) {
      useRealtimeStore.getState().resetSocialState()
    }

    this.openSocket(false)
  }

  disconnect({ purge = true }: { purge?: boolean } = {}) {
    this.clearReconnectTimer()
    this.closeCurrentSocket()
    this.userId = null
    this.accessToken = null
    this.reconnectAttempt = 0
    this.authRejected = false

    if (purge) {
      useRealtimeStore.getState().resetSocialState()
    } else {
      useRealtimeStore.getState().setConnectionState('closed')
    }
  }

  /**
   * Re-asks the server for the presence snapshot, by dropping and reopening the socket — the
   * only way there is (see `refreshPresence` in `lib/friend-mutations.ts`).
   */
  resynchronize() {
    if (!this.userId || !this.accessToken || this.authRejected) {
      return
    }

    if (this.sendsAwaitingAck > 0) {
      this.resyncPending = true

      if (this.resyncGraceTimer === null) {
        this.resyncGraceTimer = setTimeout(() => {
          this.resyncGraceTimer = null
          this.performResynchronize()
        }, RESYNC_SEND_GRACE_MS)
      }

      return
    }

    this.performResynchronize()
  }

  sendMessage(to: string, content: string): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return false
    }

    this.socket.send(JSON.stringify({ to, content }))
    this.sendsAwaitingAck += 1
    return true
  }

  subscribe(listener: EventListener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private openSocket(isReconnect: boolean) {
    if (!this.userId || !this.accessToken || this.authRejected) {
      return
    }

    if (!navigator.onLine) {
      useRealtimeStore.getState().setConnectionState('reconnecting')
      return
    }

    useRealtimeStore
      .getState()
      .setConnectionState(isReconnect ? 'reconnecting' : 'connecting')

    const token = encodeURIComponent(this.accessToken)
    const socket = new WebSocket(buildWsUrl(`/ws/chat?token=${token}`))
    this.socket = socket

    socket.addEventListener('open', () => {
      if (this.socket !== socket) return

      this.reconnectAttempt = 0
      useRealtimeStore.getState().setConnectionState('open')
    })

    socket.addEventListener('message', (messageEvent) => {
      if (this.socket !== socket || typeof messageEvent.data !== 'string') return

      try {
        const event = parseRealtimeServerEvent(messageEvent.data)

        // The two frames that answer a send of mine — an acknowledgement, or a refusal.
        if (event.type === 'message_sent' || event.type === 'error') {
          this.sendsAwaitingAck = Math.max(0, this.sendsAwaitingAck - 1)
        }

        this.applyPresenceEvent(event)
        this.listeners.forEach((listener) => listener(event))
        // LAST: a deferred resynchronisation closes this very socket, so every listener must
        // have seen the frame before it goes.
        this.flushDeferredResync()
      } catch {
        // A malformed server event is ignored. It must not crash the authenticated shell.
      }
    })

    socket.addEventListener('close', (closeEvent) => {
      if (this.socket !== socket) return

      this.socket = null
      // Nothing will ever answer a send made over a socket that is gone, and the reconnection
      // brings a fresh snapshot on its own — so a deferred resynchronisation has nothing left
      // to wait for, and nothing left to do.
      this.sendsAwaitingAck = 0
      this.resyncPending = false
      this.clearResyncGraceTimer()

      if (closeEvent.code === AUTH_POLICY_VIOLATION_CODE) {
        this.authRejected = true
        useRealtimeStore.getState().setConnectionState('closed')
        return
      }

      this.scheduleReconnect()
    })
  }

  private applyPresenceEvent(event: RealtimeServerEvent) {
    if (event.type === 'initial_presence') {
      useRealtimeStore.getState().replacePresence(event.onlineFriendIds)
    } else if (event.type === 'presence') {
      useRealtimeStore.getState().setFriendPresence(event.userId, event.online)
    }
  }

  private scheduleReconnect() {
    if (!this.userId || !this.accessToken || this.authRejected) {
      useRealtimeStore.getState().setConnectionState('closed')
      return
    }

    useRealtimeStore.getState().setConnectionState('reconnecting')

    if (!navigator.onLine) {
      return
    }

    const exponentialDelay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_DELAY_MS,
    )
    const delayWithJitter = exponentialDelay * (0.5 + Math.random() * 0.5)

    this.reconnectAttempt += 1
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.openSocket(true)
    }, delayWithJitter)
  }

  /** Whatever asked for it, this is the reopening itself. */
  private performResynchronize() {
    this.resyncPending = false
    this.clearResyncGraceTimer()

    if (!this.userId || !this.accessToken || this.authRejected) {
      return
    }

    this.clearReconnectTimer()
    this.closeCurrentSocket()
    this.reconnectAttempt = 0
    this.openSocket(true)
  }

  private flushDeferredResync() {
    if (!this.resyncPending || this.sendsAwaitingAck > 0) return

    this.performResynchronize()
  }

  private clearResyncGraceTimer() {
    if (this.resyncGraceTimer === null) return

    clearTimeout(this.resyncGraceTimer)
    this.resyncGraceTimer = null
  }

  /**
   * Closes the socket we hold, whoever asked — a session change, a logout, going offline, or a
   * resynchronisation.
   */
  private closeCurrentSocket() {
    const socket = this.socket
    this.socket = null
    this.sendsAwaitingAck = 0
    this.resyncPending = false
    this.clearResyncGraceTimer()

    if (
      socket?.readyState === WebSocket.CONNECTING ||
      socket?.readyState === WebSocket.OPEN
    ) {
      socket.close(1000, 'Client session changed')
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer === null) return

    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private handleOnline = () => {
    if (!this.userId || !this.accessToken || this.authRejected || this.socket) return

    this.clearReconnectTimer()
    this.openSocket(true)
  }

  private handleOffline = () => {
    if (!this.userId) return

    this.clearReconnectTimer()
    this.closeCurrentSocket()
    useRealtimeStore.getState().setConnectionState('reconnecting')
  }
}

export const realtimeClient = new RealtimeClient()

export function resynchronizeRealtime() {
  realtimeClient.resynchronize()
}
