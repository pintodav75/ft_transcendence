import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, apiFetch, sharedApiErrorMessage } from '@/lib/api';
import { retryServerErrorsOnly } from '@/lib/ladders';

import type { QueryClient } from '@tanstack/react-query';
import type { RequiredProvider } from '@/lib/games';
import type { paths } from '@/lib/api-types.gen';

/**
 * The in-game accounts — read AND write, in one module.
 *
 * 🔑 WHY BOTH SIDES LIVE TOGETHER HERE, where `friends` and `teams` split them in two. There is
 * exactly ONE cache entry for this resource and THREE screens read it, none of which owns it:
 * `/home` (the reminder banner), `/solo/$ladderId` (the "can I open a slot" gate) and `/profile`
 * (the only place that can change it). A mutation invalidating the wrong key would leave the two
 * other screens telling the user something the server has already stopped believing. Keeping the
 * key, its reader and its writers within thirty lines of each other is what makes that impossible
 * to get wrong — same reason `lib/friend-mutations.ts` is the single house for relation changes.
 */

type ExternalAccountsResponse =
  paths['/users/me/external-accounts']['get']['responses'][200]['content']['application/json'];
// 201, not 200: linking CREATES a row. Reading the wrong status here types the payload as
// `never` and the build says so — which is the whole point of going through the codegen.
type LinkAccountResponse =
  paths['/users/me/external-accounts']['post']['responses'][201]['content']['application/json'];
type LinkAccountBody =
  paths['/users/me/external-accounts']['post']['requestBody']['content']['application/json'];
type UnlinkAccountResponse =
  paths['/users/me/external-accounts/{provider}']['delete']['responses'][200]['content']['application/json'];

/** One linked account: `{ provider, externalId, verified }`. */
export type ExternalAccount = ExternalAccountsResponse['externalAccounts'][number];

/**
 * The one literal for this resource's cache entry.
 *
 * 🚨 IT IS `as const` AND IT IS EXPORTED FOR A REASON: three modules read it and two mutations
 * invalidate it. An inline `['external-accounts', 'me']` written a fourth time would work right
 * up until somebody typed `'externalAccounts'`, and nothing — not the compiler, not a test —
 * would say a word: the screen would simply stop refreshing.
 */
export const EXTERNAL_ACCOUNTS_KEY = ['external-accounts', 'me'] as const;

// -------------------------------------------------------------------------- read

/**
 * My linked in-game accounts (§5.1).
 *
 * ⚠️ `enabled` exists for `/solo/$ladderId`, which must render its error screen for a malformed
 * `ladderId` having spent NO request at all (its DoD) — and this query does not depend on that
 * id, so it would otherwise fire anyway. `/home` and `/profile` both want it unconditionally.
 */
export function useExternalAccounts(enabled = true) {
  return useQuery({
    queryKey: EXTERNAL_ACCOUNTS_KEY,
    queryFn: () => apiFetch<ExternalAccountsResponse>('/users/me/external-accounts'),
    enabled,
    retry: retryServerErrorsOnly,
  });
}

/**
 * May I open a slot on a ladder of this game — i.e. do I have the account §5.1 demands?
 *
 * 🚨 THREE-VALUED ON PURPOSE, and the third value is the point. `undefined` means the answer
 * is UNKNOWN (the request is in flight, or it failed), which is NOT the same as "no". The
 * screen must not offer the button in either the `false` or the `undefined` case: a
 * `POST /matches` with no linked account is answered 400 by `validateSide()`, and a 4xx
 * writes a red line in the Chrome console — a project-rejection criterion, not a rough edge.
 * Collapsing unknown into "linked" would gamble the console on a request in flight.
 */
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

/**
 * 🚨 ONE KEY, AND ONE ONLY — THE ABSENCE OF `['team', …]` HERE IS DELIBERATE, DO NOT "FIX" IT.
 *
 * `GET /teams/{id}` serves `members[].hasLinkedAccount`, which `LineupPicker` uses to grey out
 * a player who cannot be fielded. So linking an account *does* change what the team page would
 * draw — and it still must not be invalidated from here.
 *
 * The reason is that `main.tsx` builds a bare `new QueryClient()`, with no `staleTime`: the
 * default is 0, so every query REFETCHES ON MOUNT. Walking from `/profile` to a team page
 * remounts its query and gets the fresh roster for free. Invalidating a team's entry from the
 * settings page would buy nothing and would couple `/profile` to a resource it never reads —
 * the same arbitration `myMatchesKey` documents for `/history`.
 *
 * What DOES need this call is the pair of screens that hold the accounts list itself while the
 * user is on `/profile`: the `/home` banner and the `/solo` gate, both mounted behind the same
 * router, both wrong the instant a link appears or disappears.
 */
function refreshExternalAccounts(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: EXTERNAL_ACCOUNTS_KEY });
}

// ----------------------------------------------------------------- error mapping

/**
 * `POST /users/me/external-accounts`. Takes the provider's display name because a settings page
 * lists four rows at once: "already linked" with nothing named is useless there.
 *
 * ⚠️ THE 409 IS REACHABLE WITHOUT ANY RACE, and that is why it is worded as a fact rather than
 * as a failure: `UNIQUE(user_id, provider)` means a second link on the same provider is refused,
 * and a second tab (or a stale one) is all it takes. The row is already what the user wanted, so
 * the sentence says so and the list refetches underneath.
 */
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

/**
 * `DELETE /users/me/external-accounts/{provider}`.
 *
 * ⚠️ The route is IDEMPOTENT — unlinking a provider that is not linked answers 200 — so there
 * is no "not linked" case to map. Its only 400 is a provider outside the enum, which this UI
 * cannot produce: the four rows come from the codegen union (`ALL_PROVIDERS`), so an invalid
 * provider would not compile.
 */
export function unlinkAccountErrorMessage(error: unknown, providerName: string) {
  return sharedApiErrorMessage(error) ?? `Could not unlink your ${providerName} account.`;
}

// ----------------------------------------------------------------------- hooks

/**
 * Links an in-game account.
 *
 * 🚨 THE LINK IS DECLARATIVE AT THE MVP AND THE UI MUST NOT PRETEND OTHERWISE. The server stores
 * whatever string it is given and sets `verified: false` — always, there is no verification path
 * yet (the OAuth Steam/Riot that would set it true is a separate backend workstream). So no screen
 * may draw a tick, a badge, or the word "verified" next to a row.
 *
 * 🔑 IT IS STILL WHAT UNLOCKS THE PRODUCT, unverified or not: `validateSide()` tests the PRESENCE
 * of the row, never `verified`. One typed ID here is the difference between an account that can
 * open a match and one that cannot.
 */
export function useLinkAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: LinkAccountBody) =>
      apiFetch<LinkAccountResponse>('/users/me/external-accounts', { method: 'POST', body }),
    onSuccess: () => refreshExternalAccounts(queryClient),
    // 409 = the row already exists, put there by another tab. The list on screen is stale, and
    // a message printed over a stale list is half a fix — same discipline as `isStaleRowError`
    // in `lib/friend-mutations.ts`.
    onError: (error) =>
      error instanceof ApiError && error.status === 409
        ? refreshExternalAccounts(queryClient)
        : undefined,
  });
}

/**
 * Unlinks an in-game account.
 *
 * ⚠️ THIS CAN COST THE USER A MATCH, and the calling screen owes them that warning before the
 * click: a player with no linked account is refused by `validateSide()` in 400, so unlinking
 * while fielded in a `pending` slot leaves a line-up the server will not accept. The route
 * itself checks nothing — the guard is entirely the UI's word.
 *
 * `apiFetch` sends no body and therefore no `content-type` on a DELETE (`prepareBody` in
 * `lib/api.ts`), which is what keeps Fastify from answering 400 `FST_ERR_CTP_EMPTY_JSON_BODY`.
 */
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
