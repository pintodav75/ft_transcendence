import { SocialPanel } from '@/components/social/SocialPanel'

export function SocialRail() {
  return (
    <aside
      aria-label="Social"
      // `w-social-rail` et pas `w-78` : la bande de fenêtres de chat s'ancre sur ce même token
      // (voir `ChatWindowStack`), donc la largeur du rail se décide à UN seul endroit.
      // Le débordement HORIZONTAL reste visible pour les fenêtres de chat flottantes. Le
      // débordement VERTICAL est coupé ici : chaque tabpanel possède déjà son propre
      // `overflow-y-auto`, mais laisser aussi l'aside en `overflow-visible` ajoutait toute la
      // hauteur de la liste Messages au document (900 px de viewport devenaient 2014 px).
      className="panel sticky top-4 hidden h-[calc(100dvh-2rem)] w-social-rail shrink-0 overflow-x-visible overflow-y-clip lg:block"
    >
      <SocialPanel />
    </aside>
  )
}
