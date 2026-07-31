import { SocialPanel } from '@/components/social/SocialPanel'

export function SocialRail() {
  return (
    <aside
      aria-label="Social"
      className="panel sticky top-4 hidden h-[calc(100dvh-2rem)] w-78 shrink-0 overflow-visible lg:block"
    >
      <SocialPanel />
    </aside>
  )
}
