import { Link } from '@tanstack/react-router';
import { Swords } from 'lucide-react';

import { Callout } from '@/components/ui/callout';
import { useOpenSlots } from '@/lib/matchmaking';

type LadderOpenSlotsProps = {
  ladderId: string;
  ladderName: string;
};

export function LadderOpenSlots({ ladderId, ladderName }: LadderOpenSlotsProps) {
  const { data, isPending, isError } = useOpenSlots({ ladderId, acceptableOnly: false });

  if (isPending || isError || !data) return null;

  const slots = data.slots;
  const mine = slots.filter((slot) => slot.canAccept).length;

  if (slots.length === 0) {
    return (
      <Callout tone="muted">
        No slot from another camp is open on {ladderName} right now — the ones you opened are not
        listed here.
      </Callout>
    );
  }

  return (
    <Callout tone="muted">
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <Swords aria-hidden="true" className="size-4 shrink-0" />
        <span>
          <strong className="text-text-primary">{slots.length}</strong>{' '}
          {slots.length === 1 ? 'slot is' : 'slots are'} open here
          {mine > 0 ? `, ${mine} you can accept` : ' — none you can accept yet'}.
        </span>
        <Link to="/matchmaking" search={{ ladderId }} className="underline underline-offset-2">
          See open slots
        </Link>
      </span>
    </Callout>
  );
}
