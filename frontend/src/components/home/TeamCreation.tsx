import { useState, type SubmitEvent } from 'react';

import { LadderSelect } from '@/components/home/LadderSelect';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, apiFetch } from '@/lib/api';

import type { components } from '@/lib/api-types.gen';

type Team = components['schemas']['Team'];

const NAME_MAX_LENGTH = 50; // same limit as POST /teams

function createErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    // 409 tells us which rule was hit: name already taken, or already in a team
    // on this ladder (one team per ladder per user).
    if (error.status === 409) return error.message;
    // A Zod rejection answers { errors: [...] }, so ApiError has no message to show.
    if (error.status === 400)
      return `Pick a ladder and a name of 1 to ${NAME_MAX_LENGTH} characters.`;
  }

  return 'Could not create the team.';
}

type TeamCreationProps = {
  // Called after a successful create so the parent can refresh its team list.
  onCreated: () => Promise<void>;
};

export function TeamCreation({ onCreated }: TeamCreationProps) {
  const [ladderId, setLadderId] = useState<string>();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string>();

  async function handleCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = name.trim();
    if (!ladderId || !trimmed || submitting) return;

    setSubmitting(true);
    setFormError(undefined);

    try {
      // The 201 carries the raw team row, which lacks the ladder and game names
      // the list renders — refetching is simpler than rebuilding them here.
      await apiFetch<{ team: Team }>('/teams', {
        method: 'POST',
        body: { ladderId, name: trimmed },
      });
      await onCreated();
      setName('');
    } catch (creationError) {
      setFormError(createErrorMessage(creationError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form
        onSubmit={handleCreate}
        className="flex flex-col gap-4 rounded-control border border-border-subtle p-4"
      >
        <div className="flex flex-col gap-2">
          <Label>Ladder</Label>
          <LadderSelect value={ladderId} onChange={setLadderId} excludeSolo />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="team-name">Team name</Label>
          <Input
            id="team-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={NAME_MAX_LENGTH}
            placeholder="My team"
          />
        </div>

        {formError && (
          <p className="text-sm text-arena-red" role="alert">
            {formError}
          </p>
        )}

        <Button
          type="submit"
          className="self-start"
          disabled={submitting || !ladderId || !name.trim()}
        >
          {submitting ? 'Creating…' : 'Create team'}
        </Button>
      </form>
    </>
  );
}
