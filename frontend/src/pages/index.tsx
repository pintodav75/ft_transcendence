import { SiteFooter } from '@/components/layout/SiteFooter'
import { HeroBanner } from '@/components/landing/HeroBanner'
import { GamesCards } from '@/components/games/GamesCards'
import { LandingNav } from '@/components/landing/LandingNav'

// Home / landing layout. Two flex columns: the LandingNav rail and the page body
// (which scrolls on its own). Landmarks stay distinct: nav rail, <main> content,
// and the legal <footer> are siblings — <main> wraps only the primary content.
export function Index() {
  return (
    <div className="flex h-dvh gap-4 overflow-hidden p-4">
      <LandingNav />

      <div className="flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col">
          <main className="flex-1 space-y-6">
            <HeroBanner />
            <GamesCards />
          </main>
          <SiteFooter />
        </div>
      </div>
    </div>
  )
}

export default Index