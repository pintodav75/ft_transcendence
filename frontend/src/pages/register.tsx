import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';

import { AuthCard, AuthCardContent, AuthCardFooter, AuthForm } from '@/components/auth/auth-card';
import { AuthDivider } from '@/components/auth/auth-divider';
import { AuthPageLayout } from '@/components/auth/auth-page-layout';
import { AuthPageOptions } from '@/components/auth/auth-page-options';
import { GoogleAuthButton } from '@/components/auth/google-auth-button';
import { Button } from '@/components/ui/button';
import { CardHeader } from '@/components/ui/card';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { ApiError, apiFetch } from '@/lib/api';
import { API_BASE_URL } from '@/lib/api-config';
import { registerSchema, type RegisterFormValues } from '@/lib/register-schema';
import { useAuthStore } from '@/stores/auth-store';
import type { AuthSessionResponse } from '@/types/auth';

const backendFieldMessages: Record<keyof RegisterFormValues, string> = {
  pseudo: 'Nickname must be between 3 and 30 characters.',
  email: 'Enter a valid email address.',
  password: 'Password does not meet the requirements.',
};

export function Register() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
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

  const pseudoError = dirtyFields.pseudo || isSubmitted ? errors.pseudo?.message : undefined;
  const emailError = dirtyFields.email || isSubmitted ? errors.email?.message : undefined;
  const passwordError = dirtyFields.password || isSubmitted ? errors.password?.message : undefined;

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

  return (
    <AuthPageLayout>
      <AuthCard>
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
            <p className="mt-3 max-w-80 text-sm leading-6 text-text-secondary">
              Switch to competitive mode.
            </p>
          </div>
        </CardHeader>

        <AuthCardContent>
          <AuthForm noValidate onSubmit={submitValidatedForm}>
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
                <FormMessage id="pseudo-error" className="absolute left-0 top-full mt-1">
                  {pseudoError}
                </FormMessage>
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
                <FormMessage id="email-error" className="absolute left-0 top-full mt-1">
                  {emailError}
                </FormMessage>
              ) : null}
            </div>

            <div className="relative space-y-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                autoComplete="new-password"
                placeholder="Password"
                aria-invalid={Boolean(passwordError)}
                aria-describedby={passwordError ? 'password-error' : undefined}
                {...register('password')}
              />
              {passwordError ? (
                <FormMessage id="password-error" className="absolute left-0 top-full mt-1">
                  {passwordError}
                </FormMessage>
              ) : null}
            </div>

            {errors.root?.server ? (
              <FormMessage className="text-center">{errors.root.server.message}</FormMessage>
            ) : null}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create account'}
            </Button>

            <AuthDivider />

            <GoogleAuthButton label="Google" onClick={startGoogleRegistration} />
          </AuthForm>
        </AuthCardContent>

        <AuthCardFooter>
          <div className="flex flex-col items-center gap-2">
            <p>Already have an account?</p>
            <Link
              className="font-bold text-text-secondary transition hover:text-text-primary focus-ring focus-visible:outline-offset-4"
              to="/login"
            >
              Sign in
            </Link>
          </div>
        </AuthCardFooter>
      </AuthCard>

      <AuthPageOptions />
    </AuthPageLayout>
  );
}
