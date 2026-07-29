import { API_BASE_URL } from '@/lib/api-config'
import { useAuthStore } from '@/stores/auth-store'
import type { RefreshSessionResponse } from '@/types/auth'

type JsonBody = Record<string, unknown> | unknown[]
type ApiRequestBody = BodyInit | JsonBody | null
type ApiRequestInit = Omit<ApiFetchOptions, 'skipAuthRefresh'>

export type ApiFetchOptions = Omit<RequestInit, 'body'> & {
  body?: ApiRequestBody
  skipAuth?: boolean
  skipAuthRefresh?: boolean
}

/**
 * The 429 sentence, shared by every mutation module.
 *
 * It lives HERE and not next to a domain's error mapping because it carries no domain
 * knowledge whatsoever: it describes the rate limiter, which is a property of the API layer.
 * It first sat in `team-mutations.ts`, which made `match-mutations.ts` import a "team" module
 * for a string about quotas — a dependency pointing the wrong way.
 */
export const RATE_LIMITED_MESSAGE = 'Too many requests — retry in a moment.'

export class ApiError extends Error {
  status: number
  payload: unknown

  constructor(status: number, payload: unknown, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

function buildApiUrl(path: string) {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }

  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

function shouldSerializeJson(body: ApiRequestBody): body is JsonBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    !(body instanceof FormData) &&
    !(body instanceof URLSearchParams) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(body)
  )
}

function prepareBody(
  body: ApiRequestBody | undefined,
  headers: Headers,
): BodyInit | null | undefined {
  if (body === undefined || body === null) {
    return body
  }

  if (shouldSerializeJson(body)) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    return JSON.stringify(body)
  }

  return body
}

function createRequestInit(options: ApiRequestInit): RequestInit {
  const {
    body,
    headers: optionHeaders,
    skipAuth,
    ...fetchOptions
  } = options
  const headers = new Headers(optionHeaders)
  const preparedBody = prepareBody(body, headers)
  const accessToken = useAuthStore.getState().accessToken

  if (!skipAuth && accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  return {
    ...fetchOptions,
    body: preparedBody,
    credentials: 'include',
    headers,
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T
  }

  const text = await response.text()

  if (!text) {
    return undefined as T
  }

  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return JSON.parse(text) as T
  }

  return text as T
}

// Exported so upload.ts (XMLHttpRequest, not fetch) can build an ApiError the
// exact same way as apiFetch for a non-2xx response.
export function getErrorMessage(status: number, payload: unknown) {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'error' in payload &&
    typeof payload.error === 'string'
  ) {
    return payload.error
  }

  return `API request failed with status ${status}`
}

async function createApiError(response: Response) {
  let payload: unknown

  try {
    payload = await parseResponse<unknown>(response)
  } catch {
    payload = null
  }

  return new ApiError(response.status, payload, getErrorMessage(response.status, payload))
}

// Exported so upload.ts can retry an upload once after a silent refresh, the
// same way `request()` below does for a plain apiFetch call.
export async function refreshAccessToken() {
  try {
    // Refresh uses raw fetch so apiFetch cannot recursively refresh itself.
    const response = await fetch(buildApiUrl('/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
    })

    // 204 = aucun cookie de refresh, donc aucune session à restaurer (B13). Ce n'est pas une
    // erreur, mais ce n'est pas non plus un succès : il n'y a pas de token à poser.
    // ⚠️ La garde doit être ÉCRITE, pas subie : `parseResponse` rend `undefined` sur un corps
    // vide, donc sans elle le destructuring ci-dessous jetterait un TypeError silencieusement
    // avalé par le `catch`. Le comportement serait juste, par accident.
    // ⚠️ Elle passe AVANT `response.ok` : un 204 est un 2xx.
    if (response.status === 204) {
      return false
    }

    if (!response.ok) {
      return false
    }

    const { accessToken } = await parseResponse<RefreshSessionResponse>(response)
    useAuthStore.getState().setAccessToken(accessToken)

    return true
  } catch {
    return false
  }
}

// Exported for the same reason as refreshAccessToken above: upload.ts must clear the
// session in the exact same case — refresh already attempted AND refused — otherwise the
// auth store keeps believing the user is signed in with a dead access token.
export async function logoutAfterAuthFailure() {
  useAuthStore.getState().clearSession()

  try {
    // Backend logout is best-effort after the local session has been cleared.
    await fetch(buildApiUrl('/auth/logout'), {
      method: 'POST',
      credentials: 'include',
    })
  } catch {
    // The local session is already cleared; backend logout is best-effort here.
  }
}

async function request<T>(
  path: string,
  options: ApiFetchOptions,
  canRefresh: boolean,
): Promise<T> {
  const { skipAuthRefresh, ...requestOptions } = options
  const response = await fetch(buildApiUrl(path), createRequestInit(requestOptions))

  if (
    response.status === 401 &&
    canRefresh &&
    !skipAuthRefresh
  ) {
    const refreshed = await refreshAccessToken()

    if (refreshed) {
      return request<T>(path, { ...options, skipAuthRefresh: true }, false)
    }

    await logoutAfterAuthFailure()
  }

  if (!response.ok) {
    throw await createApiError(response)
  }

  return parseResponse<T>(response)
}

export function apiFetch<T>(path: string, options: ApiFetchOptions = {}) {
  return request<T>(path, options, true)
}
