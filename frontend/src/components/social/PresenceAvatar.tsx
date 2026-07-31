import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

import type { Presence } from '@/lib/presence';

type PresenceAvatarProps = {
  src?: string | null;
  fallback: string;
  presence: Presence;
  /** Sizing of the avatar itself (`size-9` in a list row, `size-11` in a header). */
  className?: string;
};

/**
 * A friend's avatar with the little connected dot — the two social screens that show a person
 * ([FS-1]'s friends list, [FS-3]'s conversation header) draw exactly the same thing.
 *
 * 🔑 THE DOT IS PURELY VISUAL, and that is a deliberate a11y choice, not an oversight. Both
 * callers already state presence in text somewhere a screen reader reads once — the name of
 * the list ("Friends online") or the subtitle under the pseudo — so repeating it per avatar
 * would say the same word twice in a row. `unknown` draws no dot at all rather than a grey
 * one: "we do not know" and "offline" are different answers.
 */
export function PresenceAvatar({ src, fallback, presence, className }: PresenceAvatarProps) {
  return (
    <span className="relative shrink-0">
      <Avatar src={src ?? undefined} alt="" fallback={fallback} className={className} />
      {presence !== 'unknown' && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-surface-card',
            presence === 'online' ? 'bg-success' : 'bg-text-muted',
          )}
        />
      )}
    </span>
  );
}
