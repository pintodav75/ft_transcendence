// Base RELATIVE de l'API : le navigateur ne connaît qu'une seule origine applicative
// (https://localhost:5173). Vite proxifie /api/* vers le backend interne.
export const API_BASE_URL = '/api'

// URL WebSocket dérivée de l'origine courante (https wss). Ex.
export function buildWsUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${protocol}//${window.location.host}${API_BASE_URL}${suffix}`
}
