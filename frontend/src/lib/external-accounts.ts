import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, apiFetch, sharedApiErrorMessage } from '@/lib/api';
import { retryServerErrorsOnly } from '@/lib/ladders';

import type { QueryClient } from '@tanstack/react-query';
import type { RequiredProvider } from '@/lib/games';
import type { paths } from '@/lib/api-types.gen';

/**
 * The in-game accounts, read AND write in one module (friends and teams split theirs in two).
 *
 * one cache entry, three screens reading it and none of them owning it: /home (the reminder
 * banner), /solo/$ladderId (the "can I open a slot" gate) and /profile (the only one that can
 * change it). a mutation invalidating the wrong key leaves the other two showing something the
 * server stopped believing, so the key, its reader and its writers stay within 30 lines of
 * each other.
 */

type ExternalAccountsResponse =
  paths['/users/me/external-accounts']['get']['responses'][200]['content']['application/json'];
// 201, not 200: linking CREATES a row.
type LinkAccountResponse =
  paths['/users/me/external-accounts']['post']['responses'][201]['content']['application/json'];
type LinkAccountBody =
  paths['/users/me/external-accounts']['post']['requestBody']['content']['application/json'];
type UnlinkAccountResponse =
  paths['/users/me/external-accounts/{provider}']['delete']['responses'][200]['content']['application/json'];

/** One linked account: `{ provider, externalId, verified }`. */
export type ExternalAccount = ExternalAccountsResponse['externalAccounts'][number];

/** The one literal for this resource's cache entry. */
export const EXTERNAL_ACCOUNTS_KEY = ['external-accounts', 'me'] as const;

// -------------------------------------------------------------------------- read

/** My linked in-game accounts (§5.1). */
export function useExternalAccounts(enabled = true) {
  return useQuery({
    queryKey: EXTERNAL_ACCOUNTS_KEY,
    queryFn: () => apiFetch<ExternalAccountsResponse>('/users/me/external-accounts'),
    enabled,
    retry: retryServerErrorsOnly,
  });
}

/** May I open a slot on a ladder of this game — i.e. do I have the account §5.1 demands? */
export function hasLinkedProvider(
  accounts: ExternalAccount[] | undefined,
  provider: RequiredProvider,
): boolean | undefined {
  if (!accounts) return undefined;
  return accounts.some((account) => account.provider === provider);
}

/** The row for one provider, or `undefined` when it is not linked. */
export function accountFor(
  accounts: ExternalAccount[] | undefined,
  provider: RequiredProvider,
): ExternalAccount | undefined {
  return accounts?.find((account) => account.provider === provider);
}

// ------------------------------------------------------------------ invalidation

/** ONE KEY, AND ONE ONLY — THE ABSENCE OF `['team', …]` HERE IS DELIBERATE, DO NOT "FIX" IT. */
function refreshExternalAccounts(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: EXTERNAL_ACCOUNTS_KEY });
}

// ----------------------------------------------------------------- error mapping

/** `POST /users/me/external-accounts`. */
export function linkAccountErrorMessage(error: unknown, providerName: string) {
  // 429 (100/min, the global quota — this route declares none of its own) and 403.
  const shared = sharedApiErrorMessage(error);
  if (shared) return shared;

  if (error instanceof ApiError) {
    if (error.status === 409) return `Your ${providerName} account is already linked.`;
    // Caught client-side by the Zod resolver first (1-30 characters, trimmed); this is the
    // safety net for a paste that slips past it.
    if (error.status === 400) return `Enter a valid ${providerName} ID (1 to 30 characters).`;
  }

  return `Could not link your ${providerName} account.`;
}

/** `DELETE /users/me/external-accounts/{provider}`. */
export function unlinkAccountErrorMessage(error: unknown, providerName: string) {
  return sharedApiErrorMessage(error) ?? `Could not unlink your ${providerName} account.`;
}

// ----------------------------------------------------------------------- hooks

/** Links an in-game account. */
export function useLinkAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: LinkAccountBody) =>
      apiFetch<LinkAccountResponse>('/users/me/external-accounts', { method: 'POST', body }),
    onSuccess: () => refreshExternalAccounts(queryClient),
    // 409 = the row already exists, put there by another tab.
    onError: (error) =>
      error instanceof ApiError && error.status === 409
        ? refreshExternalAccounts(queryClient)
        : undefined,
  });
}

/** Unlinks an in-game account. */
export function useUnlinkAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (provider: RequiredProvider) =>
      apiFetch<UnlinkAccountResponse>(
        `/users/me/external-accounts/${encodeURIComponent(provider)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => refreshExternalAccounts(queryClient),
  });
}
