import { Pill } from '@/components/ui/pill';
import { SectionTitle } from '@/components/ui/section-title';

type MatchMapsProps = {
  /** The maps DRAWN for this match. Empty is legitimate — see the caller. */
  maps: string[];
  gameName: string;
};

/**
 * The maps this match is played on — one per game of the Bo3, drawn at random from the
 * game's pool when the slot was opened.
 *
 * 🚨 The CALLER hides this section when `maps` is empty, and that emptiness comes from the
 * DATA, never from a hard-coded list of games: only cs2 and Valorant have a pool today, and
 * a match on chess, LoL or Rocket League simply has nothing to say here. Writing the game
 * ids in the front would make this screen lie the day a pool is added to another game.
 *
 * Deliberately NOT `LadderMapPool`: that one describes a rotation a slot will draw FROM
 * ("18 maps in rotation, opening a slot draws 3"), this one states the three that WERE
 * drawn. Same primitives (`SectionTitle`, `Pill`), opposite statements.
 */
export function MatchMaps({ maps, gameName }: MatchMapsProps) {
  return (
    <section className="flex flex-col gap-3.5">
      <SectionTitle>Maps</SectionTitle>

      <p className="max-w-prose text-sm text-text-secondary">
        {maps.length === 1 ? 'The map' : `The ${maps.length} maps`} drawn for this {gameName} match,
        one per game of the Bo3.
      </p>

      {/* `role="list"` is explicit on purpose: Safari drops list semantics from a `<ul>`
          that is laid out with flex. */}
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
