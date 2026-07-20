import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
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
import {
  loginSchema,
  twoFactorSchema,
  type LoginFormValues,
  type TwoFactorFormValues,
} from '@/lib/login-schema';
import { useAuthStore } from '@/stores/auth-store';
import type { AuthSessionResponse, LoginResponse } from '@/types/auth';

export function Login() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [tempToken, setTempToken] = useState<string | null>(null);
  const {
    register: registerLoginField,
    handleSubmit: handleLoginSubmit,
    clearErrors: clearLoginErrors,
    setError: setLoginError,
    formState: {
      dirtyFields: loginDirtyFields,
      errors: loginErrors,
      isSubmitted: loginIsSubmitted,
      isSubmitting: loginIsSubmitting,
    },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: {
      email: '',
      password: '',
    },
  });
  const {
    register: registerTwoFactorField,
    handleSubmit: handleTwoFactorSubmit,
    clearErrors: clearTwoFactorErrors,
    reset: resetTwoFactorForm,
    setError: setTwoFactorError,
    formState: {
      dirtyFields: twoFactorDirtyFields,
      errors: twoFactorErrors,
      isSubmitted: twoFactorIsSubmitted,
      isSubmitting: twoFactorIsSubmitting,
    },
  } = useForm<TwoFactorFormValues>({
    resolver: zodResolver(twoFactorSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: {
      code: '',
    },
  });

  const emailError =
    loginDirtyFields.email || loginIsSubmitted ? loginErrors.email?.message : undefined;
  const passwordError =
    loginDirtyFields.password || loginIsSubmitted ? loginErrors.password?.message : undefined;
  const codeError =
    twoFactorDirtyFields.code || twoFactorIsSubmitted
      ? twoFactorErrors.code?.message
      : undefined;

  const submitLogin = handleLoginSubmit(async (values) => {
    clearLoginErrors('root.server');

    try {
      const response = await apiFetch<LoginResponse>('/auth/login', {
        method: 'POST',
        body: values,
        skipAuth: true,
        skipAuthRefresh: true,
      });

      if ('requires2FA' in response) {
        resetTwoFactorForm();
        setTempToken(response.tempToken);
        return;
      }

      setSession(response);
      await navigate({ to: '/home' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setLoginError('root.server', {
          type: 'server',
          message: 'Invalid email or password.',
        });
        return;
      }

      if (error instanceof ApiError && error.status === 400) {
        setLoginError('root.server', {
          type: 'server',
          message: 'The submitted information is invalid.',
        });
        return;
      }

      if (error instanceof ApiError && error.status === 429) {
        setLoginError('root.server', {
          type: 'server',
          message: 'Too many attempts. Please try again in a moment.',
        });
        return;
      }

      setLoginError('root.server', {
        type: 'server',
        message: 'Unable to sign in right now. Please try again later.',
      });
    }
  });

  const submitTwoFactorCode = handleTwoFactorSubmit(async ({ code }) => {
    if (!tempToken) return;

    clearTwoFactorErrors('root.server');

    try {
      const session = await apiFetch<AuthSessionResponse>('/auth/2fa/verify', {
        method: 'POST',
        body: { tempToken, code },
        skipAuth: true,
        skipAuthRefresh: true,
      });

      setSession(session);
      await navigate({ to: '/home' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setTwoFactorError('root.server', {
          type: 'server',
          message: 'The verification code is invalid.',
        });
        return;
      }

      if (error instanceof ApiError && error.status === 401) {
        setTwoFactorError('root.server', {
          type: 'server',
          message: 'This verification session has expired. Sign in again.',
        });
        return;
      }

      if (error instanceof ApiError && error.status === 429) {
        setTwoFactorError('root.server', {
          type: 'server',
          message: 'Too many attempts. Please try again in a moment.',
        });
        return;
      }

      setTwoFactorError('root.server', {
        type: 'server',
        message: 'Unable to verify the code right now. Please try again later.',
      });
    }
  });

  const startGoogleLogin = () => {
    window.location.assign(`${API_BASE_URL}/auth/oauth/google/start`);
  };

  const returnToLogin = () => {
    resetTwoFactorForm();
    setTempToken(null);
  };

  const isTwoFactorStep = tempToken !== null;

  return (
    <AuthPageLayout>
      <AuthCard>
        <CardHeader>
          <p className="flex items-center gap-3 text-xs label-caps text-text-muted">
            <span className="arena-dot-success size-2 rounded-full" />
            {isTwoFactorStep ? 'Two-factor verification' : 'Sign in'}
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
              {isTwoFactorStep
                ? 'Enter the code from your authenticator app.'
                : 'Switch to competitive mode.'}
            </p>
          </div>
        </CardHeader>

        <AuthCardContent>
          {isTwoFactorStep ? (
            <AuthForm noValidate onSubmit={submitTwoFactorCode}>
              <div className="relative space-y-2">
                <Label htmlFor="code">Authentication code</Label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  autoFocus
                  aria-invalid={Boolean(codeError)}
                  aria-describedby={codeError ? 'code-error' : 'code-help'}
                  {...registerTwoFactorField('code')}
                />
                <p id="code-help" className="text-xs text-text-muted">
                  The temporary sign-in session expires after 5 minutes.
                </p>
                {codeError ? (
                  <FormMessage id="code-error" className="absolute left-0 top-full mt-1">
                    {codeError}
                  </FormMessage>
                ) : null}
              </div>

              {twoFactorErrors.root?.server ? (
                <FormMessage className="text-center">
                  {twoFactorErrors.root.server.message}
                </FormMessage>
              ) : null}

              <Button type="submit" className="w-full" disabled={twoFactorIsSubmitting}>
                {twoFactorIsSubmitting ? 'Verifying…' : 'Verify code'}
              </Button>
            </AuthForm>
          ) : (
            <AuthForm noValidate onSubmit={submitLogin}>
              <div className="relative space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="Email address"
                  aria-invalid={Boolean(emailError)}
                  aria-describedby={emailError ? 'email-error' : undefined}
                  {...registerLoginField('email')}
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
                  autoComplete="current-password"
                  placeholder="Password"
                  aria-invalid={Boolean(passwordError)}
                  aria-describedby={passwordError ? 'password-error' : undefined}
                  {...registerLoginField('password')}
                />
                {passwordError ? (
                  <FormMessage id="password-error" className="absolute left-0 top-full mt-1">
                    {passwordError}
                  </FormMessage>
                ) : null}
              </div>

              {loginErrors.root?.server ? (
                <FormMessage className="text-center">
                  {loginErrors.root.server.message}
                </FormMessage>
              ) : null}

              <Button type="submit" className="w-full" disabled={loginIsSubmitting}>
                {loginIsSubmitting ? 'Signing in…' : 'Sign in'}
              </Button>

              <AuthDivider />

              <GoogleAuthButton
                label="Google"
                onClick={startGoogleLogin}
                disabled={loginIsSubmitting}
              />
            </AuthForm>
          )}
        </AuthCardContent>

        <AuthCardFooter>
          {isTwoFactorStep ? (
            <Button variant="ghost" onClick={returnToLogin}>
              Back to sign in
            </Button>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <p>Don&apos;t have an account yet?</p>
              <Link
                className="font-bold text-text-secondary transition hover:text-text-primary focus-ring focus-visible:outline-offset-4"
                to="/register"
              >
                Create account
              </Link>
            </div>
          )}
        </AuthCardFooter>
      </AuthCard>

      <AuthPageOptions />
    </AuthPageLayout>
  );
}

export default Login;
