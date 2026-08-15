import { SocialPanel } from '@/components/social/SocialPanel'

export function SocialRail() {
  return (
    <aside
      aria-label="Social"
      // `w-social-rail` et pas `w-78` : la bande de fenêtres de chat s'ancre sur ce même token
      // (voir `ChatWindowStack`), donc la largeur du rail se décide à UN seul endroit.
      className="panel sticky top-4 hidden h-[calc(100dvh-2rem)] w-social-rail shrink-0 overflow-x-visible overflow-y-clip lg:block"
    >
      <SocialPanel />
    </aside>
  )
}
