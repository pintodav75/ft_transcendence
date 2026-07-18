import { Link } from '@tanstack/react-router';

import { AuthLanguageSelector } from '@/components/auth/auth-language-selector';

export function AuthPageOptions() {
  return (
    <nav
      className="auth-options mt-4 flex w-full max-w-110 items-center justify-between gap-5 px-1 text-xs text-text-muted"
      aria-label="Page options"
    >
      <AuthLanguageSelector />

      <div className="flex items-center gap-5">
        <Link
          to="/terms"
          className="transition hover:text-text-primary focus-ring focus-visible:outline-offset-4"
        >
          Terms
        </Link>
        <Link
          to="/privacy"
          className="transition hover:text-text-primary focus-ring focus-visible:outline-offset-4"
        >
          Policy
        </Link>
      </div>
    </nav>
  );
}
