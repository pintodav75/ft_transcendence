// Module à EFFET DE BORD : importé en TOUT PREMIER dans server.ts pour valider
// l'environnement avant que les autres modules (db/index.ts, storage/minio.ts…) ne lisent
// `process.env` à leur chargement. En ESM les imports s'exécutent dans l'ordre, top-down :
// placer celui-ci en tête garantit que la validation tourne avant tout le reste.
import { validateEnv } from './env.js';

validateEnv();
