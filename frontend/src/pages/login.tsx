import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '@/stores/auth-store';

export function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const ready = useAuthStore((state) => state.ready);
  const user = useAuthStore((state) => state.user);

  return (
    <main className="relative min-h-screen overflow-hidden px-5 py-5 sm:px-8">
      <div className="arena-center-line pointer-events-none absolute left-1/2 top-[-8%] h-[116%] w-px rotate-[8deg]" />

      <div className="pointer-events-none absolute inset-0 hidden lg:block">
        <div className="arena-wordmark-left absolute inset-0">
          <div className="arena-wordmark-v arena-wordmark">V</div>
        </div>
        <div className="arena-wordmark-right absolute inset-0">
          <div className="arena-wordmark-s arena-wordmark">S</div>
        </div>
      </div>

      <header className="relative z-10 flex items-center justify-between text-xs label-caps text-text-muted">
        <div className="flex items-center gap-2">
          <span className="arena-dot-red size-2 rounded-full" />
          <span>Rouge</span>
          <span className="text-text-primary">1 284</span>
          <span>en file</span>
        </div>

        <div className="flex items-center gap-2">
          <span>en file</span>
          <span className="text-text-primary">1 251</span>
          <span>Bleu</span>
          <span className="arena-dot-blue size-2 rounded-full" />
        </div>
      </header>

      <section className="relative z-10 flex min-h-[calc(100vh-72px)] items-center justify-center py-10">
        <Card className="w-full max-w-[420px] p-8">
          <CardHeader>
            <p className="flex items-center gap-3 text-xs label-caps text-text-muted">
              <span className="arena-dot-success size-2 rounded-full" />
              Terminal de match / Connexion
              <span className="ml-auto max-w-[120px] truncate text-[10px]">
                {ready ? (user?.pseudo ?? 'invite') : 'session...'}
              </span>
            </p>

            <div>
              <h1 className="font-display text-5xl font-black uppercase leading-none">
                <span className="text-arena-gradient">VS</span>
                <span className="ml-3 text-text-secondary">Mode</span>
              </h1>
              <p className="mt-3 max-w-[300px] text-sm leading-6 text-text-secondary">
                Identifie-toi pour rejoindre l&apos;ar&egrave;ne, trouver des adversaires et suivre
                ton classement.
              </p>
            </div>
          </CardHeader>

          <CardContent className="mt-7">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" placeholder="toi@vsmode.gg" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  className="pr-12"
                />
                <button
                  type="button"
                  className="absolute right-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-control text-text-secondary transition hover:text-text-primary focus-ring focus-visible:outline-offset-2"
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  title={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center text-sm text-text-secondary">
              <label className="flex items-center gap-3">
                <span className="flex h-6 w-11 items-center rounded-full border border-border-strong bg-surface-input p-1">
                  <span className="h-4 w-4 rounded-full bg-text-secondary" />
                </span>
                Rester connect&eacute;
              </label>
            </div>

            <Button className="w-full">Entrer dans l&apos;ar&egrave;ne</Button>
          </CardContent>

          <CardFooter className="mt-7 border-t border-border-subtle pt-6 text-center text-sm text-text-secondary">
            <div className="flex flex-col items-center gap-2">
              <p>Pas encore de compte ?</p>
              <a
                className="font-bold text-text-secondary transition hover:text-text-primary focus-ring focus-visible:outline-offset-4"
                href="/"
              >
                Cr&eacute;er ton profil
              </a>
            </div>
          </CardFooter>
        </Card>
      </section>
    </main>
  );
}

export default Login;
