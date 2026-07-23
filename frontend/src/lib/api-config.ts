// Base RELATIVE de l'API (I4) : le navigateur ne connaît qu'une seule origine applicative
// (https://localhost:5173). Vite proxifie /api/* vers le backend interne. Plus aucun hôte
// backend codé en dur côté front → pas de cross-origin, pas de contenu mixte.
export const API_BASE_URL = '/api'

// URL WebSocket dérivée de l'origine courante (https → wss). Ex. buildWsUrl('/ws/chat?token=x')
// → wss://localhost:5173/api/ws/chat?token=x, proxifié vers le backend (upgrade WS).
export function buildWsUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${protocol}//${window.location.host}${API_BASE_URL}${suffix}`
}
