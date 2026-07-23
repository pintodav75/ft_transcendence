import { Client } from 'minio';

const ENDPOINT = process.env.MINIO_ENDPOINT;
const PORT = Number(process.env.MINIO_PORT);
const USE_SSL = process.env.MINIO_USE_SSL === 'true';
const ACCESS_KEY = process.env.MINIO_ACCESS_KEY;
const SECRET_KEY = process.env.MINIO_SECRET_KEY;
export const BUCKET_NAME = process.env.MINIO_BUCKET;

// Préfixe navigateur des médias (I4). Le navigateur ne parle PLUS jamais à http://localhost:9000
// (contenu mixte sur une page HTTPS) : il tape /media/*, que le proxy Vite réécrit vers
// http://minio:9000/* (retrait du seul préfixe /media, Host interne rétabli via changeOrigin).
const MEDIA_PREFIX = '/media';

// Transforme une URL MinIO INTERNE (http://minio:9000/<bucket>/<clé>?<query>) en chemin
// navigateur relatif (/media/<bucket>/<clé>?<query>). On ne garde que path + query : l'hôte
// interne est réinjecté par le proxy. Relatif → résolu contre l'origine applicative courante.
function toMediaPath(internalUrl: string): string {
  const parsed = new URL(internalUrl);
  return `${MEDIA_PREFIX}${parsed.pathname}${parsed.search}`;
}

// Bucket PRIVÉ dédié aux preuves de dispute — JAMAIS de policy public-read. Contrairement à un
// avatar, une capture de dispute ne doit être lisible que par un participant du match ou un
// admin. On la sert donc via URL présignée courte durée, générée seulement après la garde de
// GET /disputes/:id.
export const EVIDENCE_BUCKET = 'evidence';

export const minioClient = new Client({
  endPoint: ENDPOINT,
  port: PORT,
  useSSL: USE_SSL,
  accessKey: ACCESS_KEY,
  secretKey: SECRET_KEY,
});

// Client de SIGNATURE des URL présignées. Une URL présignée (SigV4) couvre l'en-tête `Host` :
// elle n'est valide que si la requête finale atteint MinIO avec l'hôte pour lequel elle a été
// signée. On signe donc contre l'hôte INTERNE (minio:9000) — le même que le proxy /media
// rétablit via `changeOrigin`. Ainsi MinIO reçoit exactement le host/path/query ayant servi à
// la signature. L'URL renvoyée au navigateur est ensuite convertie en /media/... (toMediaPath).
const presignClient = new Client({
  endPoint: ENDPOINT,
  port: PORT,
  useSSL: USE_SSL,
  accessKey: ACCESS_KEY,
  secretKey: SECRET_KEY,
  // Région FIXÉE : sans elle, minio-js fait un lookup réseau (GetBucketLocation) avant de
  // signer. La fixer évite tout appel réseau et garantit une signature déterministe.
  region: 'us-east-1',
});

async function ensureOneBucket(name: string, isPublic: boolean) {
  const exists = await minioClient.bucketExists(name);
  if (!exists) {
    await minioClient.makeBucket(name);
    console.log('Bucket created:', name);
  }
  // La policy est (ré)appliquée à CHAQUE démarrage — pas seulement à la création — pour que
  // « public » / « privé » soit un INVARIANT réellement garanti par l'app : si le bucket
  // préexiste avec une mauvaise policy (ex. un `evidence` resté public), on la corrige au boot.
  if (isPublic) {
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${name}/*`],
        },
      ],
    };
    await minioClient.setBucketPolicy(name, JSON.stringify(policy));
  } else {
    // Bucket privé : on RETIRE explicitement toute policy (setBucketPolicy('') = DELETE ?policy).
    // ⚠️ PAS de .catch() silencieux : une VRAIE erreur (permission, réseau, MinIO) doit remonter
    // → ensureBucket() jette et le backend REFUSE de démarrer, plutôt que de tourner avec un
    // bucket peut-être resté public (fail-CLOSED, pas fail-open). Le DELETE ?policy est idempotent
    // côté MinIO (204 même si aucune policy n'existe), donc retirer une policy absente n'est pas
    // une erreur.
    await minioClient.setBucketPolicy(name, '');
  }
}

export async function ensureBucket() {
  try {
    await ensureOneBucket(BUCKET_NAME, true); // avatars : public en lecture
    await ensureOneBucket(EVIDENCE_BUCKET, false); // preuves de dispute : privé
  } catch (error) {
    console.error('ensureBucket failed:', error);
    throw error;
  }
}

// URL PUBLIQUE (navigateur) d'un avatar : chemin RELATIF /media/avatars/<fichier>. Servi via
// le proxy /media → MinIO. Relatif = pas de contenu mixte, pas d'hôte codé en dur.
export function buildPublicUrl(filename: string): string {
  return `${MEDIA_PREFIX}/${BUCKET_NAME}/${filename}`;
}

// URL présignée en lecture (GET) sur une preuve du bucket privé, valable `expirySeconds`.
// `key` est la clé d'objet stockée en base (dispute_evidence.evidence_url). On signe contre
// l'hôte interne puis on renvoie un chemin /media/evidence/<clé>?X-Amz-... : la signature
// (query) est préservée, le proxy rétablit l'hôte interne → MinIO valide la signature.
export async function presignEvidenceUrl(key: string, expirySeconds = 300): Promise<string> {
  const signed = await presignClient.presignedGetObject(EVIDENCE_BUCKET, key, expirySeconds);
  return toMediaPath(signed);
}
