import { Pill } from '@/components/ui/pill';
import { SectionTitle } from '@/components/ui/section-title';

/** backend/src/routes/matches.ts: `limit(3)` on the random draw made when a slot opens. */
const MAPS_PER_MATCH = 3;

type LadderMapPoolProps = {
  /** Already sorted by name by the backend. EMPTY is legitimate (lol, rl, chess). */
  maps: string[];
  gameName: string;
};

/**
 * The map pool of the ladder's GAME — the very table `POST /matches` draws from, served by `GET
 * /ladders/{id}`, so this screen cannot advertise a map the server would never pick.
 */
export function LadderMapPool({ maps, gameName }: LadderMapPoolProps) {
  return (
    <section className="flex flex-col gap-3.5">
      <SectionTitle>Map pool</SectionTitle>

      <p className="max-w-prose text-sm text-text-secondary">
        {maps.length} map{maps.length === 1 ? '' : 's'} in rotation for {gameName}. Opening a
        slot draws {MAPS_PER_MATCH} of them at random — one per game of the Bo3.
      </p>

      <ul role="list" className="flex flex-wrap gap-2">
        {maps.map((map) => (
          <li key={map}>
            <Pill tone="muted">{map}</Pill>
          </li>
        ))}
      </ul>
    </section>
  );
}
