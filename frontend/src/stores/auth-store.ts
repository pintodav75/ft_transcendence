import { create } from 'zustand'

import { API_BASE_URL } from '@/lib/api-config'
import type {
  AuthSessionResponse,
  AuthUser,
  MeResponse,
  RefreshSessionResponse,
} from '@/types/auth'

type AuthState = {
  user: AuthUser | null
  accessToken: string | null
  ready: boolean
}

type AuthActions = {
  setSession: (session: AuthSessionResponse) => void
  setAccessToken: (accessToken: string | null) => void
  clearSession: () => void
  restoreSession: () => Promise<void>
  logout: () => Promise<void>
}

type AuthStore = AuthState & AuthActions

let restoreSessionPromise: Promise<void> | null = null

function buildApiUrl(path: string) {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

async function requestAuthJson<T>(
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const headers = new Headers(init.headers)

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  const response = await fetch(buildApiUrl(path), {
    ...init,
    credentials: 'include',
    headers,
  })

  if (!response.ok) {
    throw new Error(`Auth request failed with status ${response.status}`)
  }

  const text = await response.text()

  if (!text) {
    return undefined as T
  }

  return JSON.parse(text) as T
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  accessToken: null,
  ready: false,

  setSession: ({ accessToken, user }) => {
    set({ accessToken, user, ready: true })
  },

  setAccessToken: (accessToken) => {
    set({ accessToken })
  },

  clearSession: () => {
    set({ accessToken: null, user: null, ready: true })
  },

  restoreSession: async () => {
    if (restoreSessionPromise) {
      return restoreSessionPromise
    }

    restoreSessionPromise = (async () => {
      set({ ready: false })

      try {
        const session = await requestAuthJson<RefreshSessionResponse | undefined>(
          '/auth/refresh',
          { method: 'POST' },
        )

        // 204 = pas de cookie, donc pas de session (B13) : on sort READY et déconnecté.
        // ⚠️ Garde ÉCRITE, pas subie : `requestAuthJson` rend `undefined` sur un corps vide,
        // donc sans elle le destructuring jetterait un TypeError que le `catch` ci-dessous
        // avalerait — on obtiendrait le bon état par accident, en passant par un chemin
        // d'erreur. C'est exactement ce que B13 veut éviter.
        if (!session) {
          set({ accessToken: null, user: null, ready: true })
          return
        }

        const { accessToken } = session
        const { user } = await requestAuthJson<MeResponse>(
          '/users/me',
          { method: 'GET' },
          accessToken,
        )

        set({ accessToken, user, ready: true })
      } catch {
        set({ accessToken: null, user: null, ready: true })
      } finally {
        restoreSessionPromise = null
      }
    })()

    return restoreSessionPromise
  },

  logout: async () => {
    try {
      await requestAuthJson<{ ok: true }>('/auth/logout', { method: 'POST' })
    } catch {
      // Local logout must still complete when the backend is unreachable.
    } finally {
      set({ accessToken: null, user: null, ready: true })
    }
  },
}))
