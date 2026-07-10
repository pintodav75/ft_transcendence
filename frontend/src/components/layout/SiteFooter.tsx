// Slim legal footer (battlefy-style): muted copyright on the left, Terms of
// Service + Privacy Policy links on the right. hrefs are placeholders until the
// router (F1) and the legal pages exist.
export function SiteFooter() {
  return (
    <footer className="border-t border-border-subtle py-5">
      <div className="flex flex-col items-center justify-between gap-2 text-xs text-text-muted sm:flex-row">
        <p>© 2026 VSMODE</p>
        <nav className="flex items-center gap-5" aria-label="Legal">
          <a href="/terms" className="transition hover:text-text-primary">
            Terms of Service
          </a>
          <a href="/privacy" className="transition hover:text-text-primary">
            Privacy Policy
          </a>
        </nav>
      </div>
    </footer>
  )
}
