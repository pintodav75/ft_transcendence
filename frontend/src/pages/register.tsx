import { useEffect, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronDown, Eye, EyeOff, Languages } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { GoogleAuthButton } from '@/components/auth/google-auth-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, apiFetch } from '@/lib/api';
import { API_BASE_URL } from '@/lib/api-config';
import { registerSchema, type RegisterFormValues } from '@/lib/register-schema';
import { useAuthStore } from '@/stores/auth-store';
import type { AuthSessionResponse } from '@/types/auth';

const languages = [
  { code: 'en', shortLabel: 'EN', label: 'English' },
  { code: 'fr', shortLabel: 'FR', label: 'Français' },
  { code: 'es', shortLabel: 'ES', label: 'Español' },
] as const;

type Language = (typeof languages)[number];

const backendFieldMessages: Record<keyof RegisterFormValues, string> = {
  pseudo: 'Nickname must be between 3 and 30 characters.',
  email: 'Enter a valid email address.',
  password: 'Password does not meet the requirements.',
};

export function Register() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [showPassword, setShowPassword] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(languages[0]);
  const languageMenuRef = useRef<HTMLDivElement>(null);
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { dirtyFields, errors, isSubmitted, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: {
      pseudo: '',
      email: '',
      password: '',
    },
  });

  const pseudoError =
    dirtyFields.pseudo || isSubmitted ? errors.pseudo?.message : undefined;
  const emailError = dirtyFields.email || isSubmitted ? errors.email?.message : undefined;
  const passwordError =
    dirtyFields.password || isSubmitted ? errors.password?.message : undefined;

  const submitValidatedForm = handleSubmit(async (values) => {
    clearErrors('root.server');

    try {
      const session = await apiFetch<AuthSessionResponse>('/auth/register', {
        method: 'POST',
        body: values,
        skipAuth: true,
        skipAuthRefresh: true,
      });

      setSession(session);
      await navigate({ to: '/home' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        const payload = error.payload;
        const issues =
          typeof payload === 'object' && payload !== null && 'errors' in payload
            ? payload.errors
            : null;
        let hasFieldError = false;

        if (Array.isArray(issues)) {
          for (const issue of issues) {
            if (typeof issue !== 'object' || issue === null || !('path' in issue)) continue;
            if (!Array.isArray(issue.path)) continue;

            const field: unknown = issue.path[0];

            if (field === 'pseudo' || field === 'email' || field === 'password') {
              setError(field, {
                type: 'server',
                message: backendFieldMessages[field],
              });
              hasFieldError = true;
            }
          }
        }

        if (!hasFieldError) {
          setError('root.server', {
            type: 'server',
            message: 'The submitted information is invalid.',
          });
        }

        return;
      }

      if (error instanceof ApiError && error.status === 409) {
        setError('root.server', {
          type: 'server',
          message: 'This nickname or email address is already in use.',
        });
        return;
      }

      if (error instanceof ApiError && error.status === 429) {
        setError('root.server', {
          type: 'server',
          message: 'Too many attempts. Please try again in a moment.',
        });
        return;
      }

      setError('root.server', {
        type: 'server',
        message: 'Unable to create your account right now. Please try again later.',
      });
    }
  });

  const startGoogleRegistration = () => {
    window.location.assign(`${API_BASE_URL}/auth/oauth/google/start`);
  };

  useEffect(() => {
    if (!languageMenuOpen) return;

    const closeLanguageMenuOnOutsideClick = (event: PointerEvent) => {
      if (!languageMenuRef.current?.contains(event.target as Node)) {
        setLanguageMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeLanguageMenuOnOutsideClick);

    return () => {
      document.removeEventListener('pointerdown', closeLanguageMenuOnOutsideClick);
    };
  }, [languageMenuOpen]);

  return (
    <main className="register-page relative h-dvh overflow-hidden px-5 py-5 sm:px-8">
      <div className="arena-center-line pointer-events-none absolute left-1/2 top-[-8%] z-[1] h-[116%] w-px rotate-[8deg]" />

      <div className="pointer-events-none absolute inset-0 hidden lg:block">
        <div className="arena-wordmark-left absolute inset-0">
          <div className="arena-wordmark-v arena-wordmark">V</div>
        </div>
        <div className="arena-wordmark-right absolute inset-0">
          <div className="arena-wordmark-s arena-wordmark">S</div>
        </div>
      </div>

      <section className="register-shell relative z-10 flex h-full flex-col items-center overflow-y-auto py-10">
        <Card className="register-card w-full max-w-[440px] bg-surface-card/84 p-8">
          <CardHeader>
            <p className="flex items-center gap-3 text-xs label-caps text-text-muted">
              <span className="arena-dot-success size-2 rounded-full" />
              Create account
            </p>

            <div>
              <h1 className="font-display text-5xl font-black italic uppercase leading-none">
                <Link
                  to="/"
                  aria-label="Back to home"
                  className="inline-block transition hover:opacity-90 focus-ring focus-visible:outline-offset-4"
                >
                  <span className="-mr-[0.12em] inline-block pr-[0.12em] text-arena-gradient tracking-[-0.06em]">
                    VS
                  </span>
                  <span className="ml-3 text-text-secondary">Mode</span>
                </Link>
              </h1>
              <p className="mt-3 max-w-[320px] text-sm leading-6 text-text-secondary">
                Switch to competitive mode.
              </p>
            </div>
          </CardHeader>

          <CardContent className="register-card-content mt-7">
            <form
              className="register-form space-y-5"
              noValidate
              onSubmit={submitValidatedForm}
            >
              <div className="relative space-y-2">
                <Label htmlFor="pseudo">Nickname</Label>
                <Input
                  id="pseudo"
                  type="text"
                  autoComplete="username"
                  placeholder="Nickname"
                  aria-invalid={Boolean(pseudoError)}
                  aria-describedby={pseudoError ? 'pseudo-error' : undefined}
                  {...register('pseudo')}
                />
                {pseudoError ? (
                  <p
                    id="pseudo-error"
                    role="alert"
                    className="absolute left-0 top-full mt-1 text-xs text-arena-red"
                  >
                    {pseudoError}
                  </p>
                ) : null}
              </div>

              <div className="relative space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="Email address"
                  aria-invalid={Boolean(emailError)}
                  aria-describedby={emailError ? 'email-error' : undefined}
                  {...register('email')}
                />
                {emailError ? (
                  <p
                    id="email-error"
                    role="alert"
                    className="absolute left-0 top-full mt-1 text-xs text-arena-red"
                  >
                    {emailError}
                  </p>
                ) : null}
              </div>

              <div className="relative space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Password"
                    className="pr-12"
                    aria-invalid={Boolean(passwordError)}
                    aria-describedby={passwordError ? 'password-error' : undefined}
                    {...register('password')}
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-control text-text-secondary transition hover:text-text-primary focus-ring focus-visible:outline-offset-2"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
                {passwordError ? (
                  <p
                    id="password-error"
                    role="alert"
                    className="absolute left-0 top-full mt-1 text-xs text-arena-red"
                  >
                    {passwordError}
                  </p>
                ) : null}
              </div>

              {errors.root?.server ? (
                <p role="alert" className="text-center text-xs text-arena-red">
                  {errors.root.server.message}
                </p>
              ) : null}

              <Button
                type="submit"
                className="w-full border border-action-primary-border font-semibold"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Creating…' : 'Create account'}
              </Button>

              <div className="flex items-center gap-3 text-xs text-text-muted">
                <span className="h-px flex-1 bg-border-subtle" />
                <span className="whitespace-nowrap">Or continue with</span>
                <span className="h-px flex-1 bg-border-subtle" />
              </div>

              <GoogleAuthButton label="Google" onClick={startGoogleRegistration} />
            </form>
          </CardContent>

          <CardFooter className="register-card-footer mt-7 border-t border-border-subtle pt-6 text-center text-sm text-text-secondary">
            <div className="flex flex-col items-center gap-2">
              <p>Already have an account?</p>
              <Link
                className="font-bold text-text-secondary transition hover:text-text-primary focus-ring focus-visible:outline-offset-4"
                to="/login"
              >
                Sign in
              </Link>
            </div>
          </CardFooter>
        </Card>

        <nav
          className="register-options mt-4 flex w-full max-w-[440px] items-center justify-between gap-5 px-1 text-xs text-text-muted"
          aria-label="Page options"
        >
          <div ref={languageMenuRef} className="relative">
            <button
              type="button"
              className="flex h-8 items-center gap-2 rounded-control px-2 font-bold transition hover:text-text-primary focus-ring focus-visible:outline-offset-2"
              aria-label={`Language: ${selectedLanguage.label}`}
              aria-haspopup="menu"
              aria-expanded={languageMenuOpen}
              onClick={() => setLanguageMenuOpen((open) => !open)}
            >
              <Languages className="h-4 w-4" aria-hidden="true" />
              <span>{selectedLanguage.shortLabel}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition ${languageMenuOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>

            {languageMenuOpen ? (
              <div
                className="absolute left-0 top-full z-20 mt-2 w-36 rounded-control border border-border-subtle bg-surface-card-strong p-1 shadow-card"
                role="menu"
                aria-label="Choose language"
              >
                {languages.map((language) => {
                  const isSelected = selectedLanguage.code === language.code;

                  return (
                    <button
                      key={language.code}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isSelected}
                      className={`flex w-full items-center justify-between rounded-control px-3 py-2 text-left transition hover:bg-surface-card hover:text-text-primary focus-ring ${isSelected ? 'text-text-primary' : 'text-text-secondary'}`}
                      onClick={() => {
                        setSelectedLanguage(language);
                        setLanguageMenuOpen(false);
                      }}
                    >
                      <span>{language.label}</span>
                      <span className="text-[10px] font-bold">{language.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

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
      </section>
    </main>
  );
}
