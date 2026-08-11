import { cn } from '@/lib/utils';

/**
 * Classes for the trailing link of a SectionTitle ("See the full ladder", "See the whole board").
 *
 * .ts next to button-variants.ts: exports no component, so Fast Refresh stays happy.
 * normal-case and font-sans are load-bearing, not decoration — a SectionTitle puts label-caps
 * on its row, which would otherwise make the link read as another small-caps label instead of
 * something you can click.
 */
export function sectionLinkClasses(className?: string) {
  return cn(
    'focus-ring border-b border-border-strong pb-0.5 font-sans text-[0.6875rem] normal-case tracking-normal text-text-secondary hover:text-text-primary',
    className,
  );
}
