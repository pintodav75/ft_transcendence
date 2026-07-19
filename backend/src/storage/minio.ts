import { Client } from 'minio';

const ENDPOINT = process.env.MINIO_ENDPOINT;
const PORT = Number(process.env.MINIO_PORT);
const USE_SSL = process.env.MINIO_USE_SSL === 'true';
const ACCESS_KEY = process.env.MINIO_ACCESS_KEY;
const SECRET_KEY = process.env.MINIO_SECRET_KEY;
export const BUCKET_NAME = process.env.MINIO_BUCKET;
export const PUBLIC_URL = process.env.MINIO_PUBLIC_URL;

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
// elle n'est valide que si le navigateur tape l'hôte pour lequel elle a été signée. Le client
// interne ci-dessus pointe sur `minio:9000` (réseau Docker), injoignable depuis le navigateur.
// On signe donc avec l'hôte PUBLIC (MINIO_PUBLIC_URL) pour que l'URL soit à la fois valide ET
// résoluble côté client.
const publicUrl = new URL(PUBLIC_URL);
const presignClient = new Client({
  endPoint: publicUrl.hostname,
  port: publicUrl.port
    ? Number(publicUrl.port)
    : publicUrl.protocol === 'https:'
      ? 443
      : 80,
  useSSL: publicUrl.protocol === 'https:',
  accessKey: ACCESS_KEY,
  secretKey: SECRET_KEY,
  // Région FIXÉE : sans elle, minio-js fait un lookup réseau de la région du bucket avant de
  // signer → il taperait `localhost:9000`, qui DEPUIS le conteneur backend est le backend
  // lui-même (pas MinIO) → 500. La signer localement évite tout appel réseau.
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

export function buildPublicUrl(filename: string): string {
  return `${PUBLIC_URL}/${BUCKET_NAME}/${filename}`;
}

// URL présignée en lecture (GET) sur une preuve du bucket privé, valable `expirySeconds`.
// `key` est la clé d'objet stockée en base (dispute_evidence.evidence_url).
export function presignEvidenceUrl(key: string, expirySeconds = 300): Promise<string> {
  return presignClient.presignedGetObject(EVIDENCE_BUCKET, key, expirySeconds);
}
