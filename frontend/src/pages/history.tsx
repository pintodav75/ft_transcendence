import { History as HistoryIcon } from 'lucide-react';

// Placeholder: the personal match history is its own ticket. It exists now so the
// "History" item of the left rail leads somewhere real. No network call.
export function History() {
  return (
    <div className="panel flex flex-col gap-3 p-6">
      <p className="flex items-center gap-2 text-xs label-caps text-success">
        <HistoryIcon className="size-4" /> Coming soon
      </p>
      <h1 className="text-3xl label-caps-black">History</h1>
      <p className="max-w-prose text-sm text-text-secondary">
        Coming soon: all your past matches, scores and Elo changes. A team&apos;s own history
        is already on its page.
      </p>
    </div>
  );
}
