import { Link } from '@tanstack/react-router';

import { OpenSlotRow } from '@/components/matchmaking/OpenSlotRow';
import { SectionTitle } from '@/components/ui/section-title';
import { sectionLinkClasses } from '@/components/ui/link-variants';

import type { OpenSlot } from '@/lib/matchmaking';

type OpenSlotsTeaserProps = {
  /** Already filtered to what this account can accept AND is still in time for — empty renders nothing. */
  slots: OpenSlot[];
};

/** « Slots you can take tonight » — a three-row teaser of the matchmaking board. */
export function OpenSlotsTeaser({ slots }: OpenSlotsTeaserProps) {
  if (slots.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <SectionTitle
        action={
          <Link to="/matchmaking" className={sectionLinkClasses()}>
            See the whole board
          </Link>
        }
      >
        Slots you can take
      </SectionTitle>

      <ul role="list" aria-label="Open slots you can accept" className="flex min-w-0 flex-col gap-3">
        {slots.map((slot) => (
          <OpenSlotRow key={slot.id} slot={slot} refusal={null} action={null} />
        ))}
      </ul>
    </div>
  );
}
