import { Link } from '@tanstack/react-router'

export function SiteFooter() {
  return (
    <footer className="mt-6 border-t border-border-subtle py-5">
      <div className="flex flex-col items-center justify-between gap-2 text-xs text-text-muted sm:flex-row">
        <p>© 2026 VSMODE</p>
        <nav className="flex items-center gap-5" aria-label="Legal">
          <Link to="/terms" className="transition hover:text-text-primary">
            Terms of Service
          </Link>
          <Link to="/privacy" className="transition hover:text-text-primary">
            Privacy Policy
          </Link>
        </nav>
      </div>
    </footer>
  )
}
