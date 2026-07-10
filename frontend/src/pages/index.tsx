import { LeftNav } from '@/components/layout/LeftNav'
import { RightNav } from '@/components/layout/RightNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { HeroBanner } from '@/components/home/HeroBanner'
import { GameRail } from '@/components/home/GameRail'

// Home / landing layout. LeftNav and RightNav are fixed, full-height floating
// rails; everything else lives in a single vertically-scrollable viewport
// between them (padded so content never slides under the rails).
export function Index() {
  return (
    <main className="arena-background relative h-screen overflow-hidden">
      <div className="arena-sidewash pointer-events-none absolute inset-0 z-0" />

      <LeftNav />
      <RightNav />

      {/* Scrollable center viewport between the two floating rails.
          pl-80 clears the w-72 left rail (+ margins); pr-28 clears the w-20 right rail. */}
      <div className="relative z-10 h-screen overflow-y-auto">
        <div className="flex min-h-screen flex-col pl-80 pr-28 pt-4">
          <div className="flex-1 space-y-8">
            <HeroBanner />
            <GameRail />
          </div>
          <SiteFooter />
        </div>
      </div>
    </main>
  )
}

export default Index