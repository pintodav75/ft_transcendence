import { cn } from '@/lib/utils';

/**
 * The trailing link of a `SectionTitle` — « See the full ladder », « See the whole board ».
 *
 * Lives in a `.ts` next to `button-variants.ts`, and for the same two reasons: a class string
 * shared by elements that must stay real links (a `<Link>` that navigates), and a module that
 * exports no component, so Fast Refresh is not broken by it.
 *
 * Extracted at its SECOND use (repo rule): written inline in `LadderExcerpt`, needed verbatim by
 * `/home`'s open-slots teaser. Copying the string was the alternative, and the reuse rule
 * forbids it — with reason: the underline is the whole affordance here. `label-caps` (which a
 * `SectionTitle` applies to its row) would otherwise make the link read as another small-caps
 * label, so `normal-case` and `font-sans` are load-bearing, not decoration.
 */
export function sectionLinkClasses(className?: string) {
  return cn(
    'focus-ring border-b border-border-strong pb-0.5 font-sans text-[0.6875rem] normal-case tracking-normal text-text-secondary hover:text-text-primary',
    className,
  );
}
