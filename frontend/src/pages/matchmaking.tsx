import { Swords } from 'lucide-react';

// Placeholder: the global matchmaking board is its own ticket. It exists now so the
// "Matchmaking" item of the left rail leads somewhere real. No network call.
export function Matchmaking() {
  return (
    <div className="panel flex flex-col gap-3 p-6">
      <p className="flex items-center gap-2 text-xs label-caps text-success">
        <Swords className="size-4" /> Coming soon
      </p>
      <h1 className="text-3xl label-caps-black">Matchmaking</h1>
      <p className="max-w-prose text-sm text-text-secondary">
        Coming soon: every open slot of every ladder, in one place. Opening and accepting a
        slot already works from a team page.
      </p>
    </div>
  );
}
