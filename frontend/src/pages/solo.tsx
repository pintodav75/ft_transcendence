import { User } from 'lucide-react';

// Placeholder: solo play is its own ticket. It exists now so the "Solo" item of the left
// rail leads somewhere real instead of being a dead, greyed-out entry. No network call.
export function Solo() {
  return (
    <div className="panel flex flex-col gap-3 p-6">
      <p className="flex items-center gap-2 text-xs label-caps text-success">
        <User className="size-4" /> Coming soon
      </p>
      <h1 className="text-3xl label-caps-black">Solo</h1>
      <p className="max-w-prose text-sm text-text-secondary">
        Coming soon: 1v1 ladders you can join without a team.
      </p>
    </div>
  );
}
