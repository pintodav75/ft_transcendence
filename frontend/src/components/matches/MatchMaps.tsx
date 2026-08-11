import { Pill } from '@/components/ui/pill';
import { SectionTitle } from '@/components/ui/section-title';

type MatchMapsProps = {
  /** The maps DRAWN for this match. Empty is legitimate — see the caller. */
  maps: string[];
  gameName: string;
};

/**
 * The maps this match is played on — one per game of the Bo3, drawn at random from the game's
 * pool when the slot was opened.
 */
export function MatchMaps({ maps, gameName }: MatchMapsProps) {
  return (
    <section className="flex flex-col gap-3.5">
      <SectionTitle>Maps</SectionTitle>

      <p className="max-w-prose text-sm text-text-secondary">
        {maps.length === 1 ? 'The map' : `The ${maps.length} maps`} drawn for this {gameName} match,
        one per game of the Bo3.
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
