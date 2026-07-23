import { defineConfig } from 'vite';
import type { ProxyOptions } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
// tanstackRouter is the auto generation of the routeTree.gen.ts

// Valide une cible proxy INTERNE (présence + URL bien formée) SANS jamais afficher sa valeur
// (elle porte l'hôte interne, on ne la fuite pas dans les logs). Renvoie l'URL validée.
function requireProxyTarget(name: 'API_PROXY_TARGET' | 'MINIO_PROXY_TARGET'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the Vite dev proxy but is missing or empty`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  // Une URL syntaxiquement valide ne suffit pas : `javascript:`, `file:`, `data:`, `ftp:`…
  // passent `new URL()` mais ne peuvent pas servir de cible de proxy HTTP → on échoue TÔT
  // (exigence I4). On n'affiche que le NOM de la variable, jamais sa valeur.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must use http: or https:`);
  }
  return value;
}

// HTTPS UNIQUEMENT pour `vite serve` : on lit le cert dev généré par le backend (volume monté
// en lecture seule). `vite build` ne doit PAS dépendre d'un cert/volume actif → si les fichiers
// sont absents (build sur l'hôte, CI…), on retombe simplement en HTTP.
const CERT_FILE = '/app/certs/cert.pem';
const KEY_FILE = '/app/certs/key.pem';
const httpsOptions =
  existsSync(CERT_FILE) && existsSync(KEY_FILE)
    ? { cert: readFileSync(CERT_FILE), key: readFileSync(KEY_FILE) }
    : undefined;

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  // Les cibles proxy ne concernent QUE le serveur de dev (`vite serve`). On les valide ici et
  // pas au niveau module pour que `vite build` (sur l'hôte, sans ces vars) reste possible.
  const proxy: Record<string, ProxyOptions> | undefined =
    command === 'serve'
      ? {
          // ⚠️⚠️ INVARIANT I4 — CES TROIS ÉLÉMENTS FORMENT UN TOUT INDISSOCIABLE :
          //   (1) le navigateur parle à /api/*  (jamais à https://backend:3000 en direct) ;
          //   (2) on retire le SEUL préfixe /api avant d'atteindre les routes backend
          //       (/api/auth/refresh → /auth/refresh) ;
          //   (3) on réécrit le Path du refresh cookie /auth → /api/auth (cookiePathRewrite).
          // Modifier UN SEUL des trois casse SILENCIEUSEMENT la restauration de session : le
          // navigateur ne renverrait plus le cookie sur /api/auth/refresh, sans erreur visible.
          '/api': {
            target: requireProxyTarget('API_PROXY_TARGET'),
            changeOrigin: true,
            // Backend en HTTPS auto-signé, joignable UNIQUEMENT sur le réseau Docker interne.
            secure: false,
            // Upgrade WebSocket pour /api/ws/chat. La query (?token=) est conservée par http-proxy.
            ws: true,
            rewrite: (path) => path.replace(/^\/api/, ''),
            cookiePathRewrite: { '/auth': '/api/auth' },
          },
          // Médias MinIO : le navigateur tape /media/* (page HTTPS, pas de contenu mixte). On
          // retire le SEUL préfixe /media ; changeOrigin rétablit le Host interne minio:9000 —
          // indispensable pour que les URLs présignées (SigV4, qui couvrent le Host) restent
          // valides. Query conservée.
          '/media': {
            target: requireProxyTarget('MINIO_PROXY_TARGET'),
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/media/, ''),
            // ⚠️ AUCUN cookie applicatif ne doit atteindre MinIO ni en revenir : on strippe
            // l'en-tête `Cookie` en requête (ex. l'état OAuth posé en Path=/) et tout `Set-Cookie`
            // en réponse. MinIO n'a aucune session applicative à connaître.
            configure: (proxy) => {
              proxy.on('proxyReq', (proxyReq) => {
                proxyReq.removeHeader('cookie');
              });
              proxy.on('proxyRes', (proxyRes) => {
                delete proxyRes.headers['set-cookie'];
              });
            },
          },
        }
      : undefined;

  return {
    plugins: [
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        // this makes imports like @/components/ui/button work instead of ../../components/ui/button.
      },
    },
    server: {
      host: true,
      port: 5173,
      https: httpsOptions,
      watch: {
        usePolling: true,
        // idk alternative way of hot reload that works on Windows too
      },
      proxy,
    },
  };
});
