import { z } from 'zod';

// Validation des variables d'environnement AU DÉMARRAGE. Objectif I4 : échouer TÔT et
// LISIBLEMENT si une variable manque / est malformée, plutôt que de crasher plus tard avec
// une erreur obscure (ex. `new URL(undefined)`), ou pire, de tourner à moitié configuré.
//
// ⚠️ On n'affiche JAMAIS la VALEUR d'une variable (ce sont des secrets), seulement son NOM.

const httpUrl = z.string().refine(
  (value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  },
  { message: 'must be a valid http(s) URL' },
);

const port = z
  .string()
  .regex(/^\d+$/, 'must be a numeric port')
  .refine((value) => {
    const n = Number(value);
    return n > 0 && n < 65536;
  }, 'must be a port between 1 and 65535');

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // Secret minimum : 16 caractères. Attrape un `.env` laissé sur `changeme` (8) sans
  // exiger une entropie précise (le README recommande `openssl rand -hex 64`).
  JWT_SECRET: z.string().min(16, 'must be at least 16 characters'),

  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PORT: port,
  MINIO_USE_SSL: z.enum(['true', 'false']),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().min(1),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: httpUrl,
  FRONTEND_URL: httpUrl,

  REDIS_HOSTNAME: z.string().min(1),
  REDIS_PORT: port,
  REDIS_PASSWORD: z.string().min(1),

  // Multiplicateur de TOUS les quotas de rate-limit (voir `utils/rate-limit.ts`). Optionnel :
  // absent = 1 = quotas de production. Bornes volontaires : entier ≥ 1 (0 ou une fraction
  // fermerait l'API au lieu de l'ouvrir, ce que personne n'attend d'une variable de confort)
  // et ≤ 10000 (au-delà, autant dire que le plugin est débranché — ce n'est pas le but).
  RATE_LIMIT_FACTOR: z
    .string()
    .regex(/^\d+$/, 'must be a positive integer')
    .refine((value) => {
      const n = Number(value);
      return n >= 1 && n <= 10_000;
    }, 'must be between 1 and 10000')
    .optional(),
});

export function validateEnv(): void {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    // On dédoublonne les noms de variables fautives et on les affiche SANS leur valeur.
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    console.error(
      `Invalid environment configuration — check these variables: ${names.join(', ')}`,
    );
    process.exit(1);
  }
}
