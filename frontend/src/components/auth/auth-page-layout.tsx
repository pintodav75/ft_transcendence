import type { ReactNode } from 'react';

type AuthPageLayoutProps = {
  children: ReactNode;
};

export function AuthPageLayout({ children }: AuthPageLayoutProps) {
  return (
    <main className="auth-page relative h-dvh overflow-hidden px-5 py-5 sm:px-8">
      <div className="arena-center-line pointer-events-none absolute left-1/2 -top-[8%] z-1 h-[116%] w-px rotate-8" />

      <div className="pointer-events-none absolute inset-0 hidden lg:block">
        <div className="arena-wordmark-left absolute inset-0">
          <div className="arena-wordmark-v arena-wordmark">V</div>
        </div>
        <div className="arena-wordmark-right absolute inset-0">
          <div className="arena-wordmark-s arena-wordmark">S</div>
        </div>
      </div>

      <section className="auth-shell relative z-10 flex h-full flex-col items-center overflow-y-auto py-10">
        {children}
      </section>
    </main>
  );
}
