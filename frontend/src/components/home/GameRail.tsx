// Placeholder, on peut le remplacer par des cartes plus graphiques etc
// currently:
// a horizontal scroll-snap rail of cards.
// maybe make a game-card component later?

type Game = {
  name: string;
  provider: string;
  formats: string;
  monogram: string;
  players: string;
  note: string;
  // Multi-layer gradient copied from the mockup's card-* classes.
  gradient: string;
};

const GAMES: Game[] = [
  {
    name: 'Valorant',
    provider: 'Riot',
    formats: '5v5 / 2v2',
    monogram: 'VAL',
    players: '1,248 players',
    note: 'Queue ~2 min',
    gradient: 'linear-gradient(130deg, #271d27 0%, #3e2a32 44%, #8d3e46 100%), #211821',
  },
  {
    name: 'Rocket League',
    provider: 'Epic',
    formats: '1v1 / 2v2 / 3v3',
    monogram: 'RL',
    players: '879 teams',
    note: '± 80 ELO',
    gradient: 'linear-gradient(135deg, #122821 0%, #155545 44%, #d38f35 100%), #10221e',
  },
  {
    name: 'Counter-Strike 2',
    provider: 'Steam',
    formats: '5v5 / Wingman',
    monogram: 'CS2',
    players: '642 teams',
    note: 'Lockout 30 min',
    gradient: 'linear-gradient(135deg, #171a1d 0%, #3a3328 48%, #c16c36 100%), #171a1d',
  },
  {
    name: 'Chess',
    provider: 'Chess.com',
    formats: '1v1',
    monogram: 'CH',
    players: 'Top 1769',
    note: 'Solo ELO',
    gradient: 'linear-gradient(135deg, #111820 0%, #23322d 55%, #d6b671 100%), #111820',
  },
  {
    name: 'League of Legends',
    provider: 'Riot',
    formats: '5v5',
    monogram: 'LOL',
    players: 'Teams 5v5',
    note: 'Lockout 60 min',
    gradient: 'linear-gradient(135deg, #101d2a 0%, #1f4050 48%, #755a33 100%), #101d2a',
  },
];

export function GameRail() {
  return (
    <section className="min-w-0">
      <div className="mb-4">
        <p className="text-xs label-caps text-success">Swipe the arenas</p>
        <h2 className="mt-1 text-2xl label-caps-black">
          Choose your game
        </h2>
      </div>

      <div
        tabIndex={0}
        aria-label="Available games"
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-none] focus-ring focus-visible:outline-offset-4 [&::-webkit-scrollbar]:hidden"
      >
        {GAMES.map((game) => (
          <article
            key={game.name}
            className="relative flex aspect-3/4 w-60 shrink-0 snap-start flex-col overflow-hidden rounded-card border border-white/10 p-5 shadow-card"
            style={{ backgroundImage: game.gradient }}
          >
            {/* legibility wash + oversized monogram, both behind the copy */}
            <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-transparent to-black/80" />
            <span className="pointer-events-none absolute right-4 top-16 text-7xl font-black leading-none text-white/10">
              {game.monogram}
            </span>

            <div className="relative flex items-center justify-between gap-2 text-[11px] label-caps text-white/75">
              <span className="truncate">{game.provider}</span>
              <span className="truncate">{game.formats}</span>
            </div>

            <div className="relative mt-auto space-y-3">
              <h3 className="text-2xl font-black leading-tight text-white">{game.name}</h3>
              <div className="flex items-center justify-between gap-2 text-[11px] label-caps text-white/75">
                <span className="truncate">{game.players}</span>
                <strong className="truncate text-white">{game.note}</strong>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
