import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormMessage } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { labelClasses } from '@/components/ui/label-variants';
import { SectionTitle } from '@/components/ui/section-title';
import { SECTION_TITLE_SIZE } from '@/components/profile/section-title-size';
import { ALL_PROVIDERS, providerLabel } from '@/lib/games';
import {
  accountFor,
  linkAccountErrorMessage,
  unlinkAccountErrorMessage,
  useExternalAccounts,
  useLinkAccount,
  useUnlinkAccount,
} from '@/lib/external-accounts';
import { linkAccountSchema, type LinkAccountFormValues } from '@/lib/link-account-schema';
import { useReturnFocus } from '@/lib/use-return-focus';

import type { ExternalAccount } from '@/lib/external-accounts';
import type { RequiredProvider } from '@/lib/games';

/**
 * The in-game accounts section of /profile: link and unlink.
 *
 * 🚨 THIS IS THE LAST LOCK ON THE CENTRAL FEATURE OF THE PLATFORM, which is why the input is
 * offered straight away instead of hiding behind a button the way `PasswordChange` does.
 * `validateSide()` refuses a line-up holding a player with no row in `user_external_accounts`
 * (400 `unlinkedPlayers`): without a linked account a player cannot be fielded at all, and the
 * `/home` reminder sends people here for that one purpose.
 *
 * 🚨 THE LINK IS DECLARATIVE AND NOTHING HERE MAY SUGGEST OTHERWISE. The server stores the
 * string it is given and always sets `verified: false` — the OAuth flow that would set it true
 * is a separate backend workstream. No tick, no badge, no "verified" anywhere on this screen.
 *
 * ONE DIALOG FOR ALL ROWS, so the confirmation state cannot drift: one `unlinking` provider,
 * one pending flag, one error, instead of one dialog per row whose open state could get out of
 * step with the row it belongs to.
 */

/**
 * Size of the provider name, shared by BOTH states of a row.
 *
 * One notch above the 12px default of `labelClasses()` and one below the 16px of the account id
 * it introduces — deliberately between the page's two idioms: at 16px the name weighed as much
 * as the "Game accounts" section title above it.
 *
 * ⚠️ That puts it out of step with `PasswordChange`, whose labels stay at 12px, and that is
 * intended: these rows swap between a FORM state and a DISPLAY state, so the name has to keep
 * reading as a heading once the field is gone.
 */
const PROVIDER_NAME_SIZE = 'text-sm';

type LinkedAccountsProps = {
  /** The page's single live region — see the note in `pages/profile.tsx`. */
  announce: (message: string) => void;
};

export function LinkedAccounts({ announce }: LinkedAccountsProps) {
  const accountsQuery = useExternalAccounts();
  const unlinkAccount = useUnlinkAccount();
  /** Which provider the confirmation is about, `null` when the dialog is closed. */
  const [unlinking, setUnlinking] = useState<RequiredProvider | null>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  /**
   * Both actions destroy the control that was pressed — linking unmounts the form, unlinking
   * unmounts its own button — so focus would land on `<body>` and throw a keyboard user back
   * to the top of the page. The heading is the landing point for BOTH, the way
   * `PasswordChange` already does it: it is stable, and a screen reader reads the name of the
   * section on arrival, which is the context somebody needs after the row changed shape.
   */
  const { ref: headingRef, returnFocus } = useReturnFocus<HTMLHeadingElement>();

  const accounts = accountsQuery.data?.externalAccounts;

  async function handleUnlink() {
    if (!unlinking) return;

    const name = providerLabel(unlinking);
    setUnlinkError(null);
    try {
      await unlinkAccount.mutateAsync(unlinking);
      setUnlinking(null);
      announce(`${name} account unlinked.`);
      returnFocus();
    } catch (err) {
      setUnlinkError(unlinkAccountErrorMessage(err, name));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle headingRef={headingRef} headingClassName={SECTION_TITLE_SIZE}>
        Game accounts
      </SectionTitle>

      {accountsQuery.isPending ? (
        <Callout>Loading your linked accounts…</Callout>
      ) : accountsQuery.isError ? (
        /* The section stands in for itself rather than replacing the page: the other four
           sections of /profile are perfectly usable while this one is unreachable. */
        <Callout tone="danger">
          Your linked accounts could not be loaded. Reload the page to try again.
        </Callout>
      ) : (
        /**
         * A list, not a stack of <div>s: a screen reader announces the item count and lets its
         * user step through them, which is the whole question this section answers.
         *
         * 🚨 A GRID AND NOT `flex-wrap`: with a declared column count, "two per row" is
         * STRUCTURAL instead of emergent. A `max-width` on a flex ITEM shrinks it below its
         * basis, which FREES space and lets a third item fit on wide screens — "two per row"
         * and "each capped" contradict each other while both rules sit on the same element.
         *
         * 🚨 `justify-items-*` (items within their track) and NOT `justify-content-*` (tracks
         * within the grid). The two look alike and only one works here: `grid-cols-2` tracks are
         * `1fr`, they absorb all free space, so there is nothing left for `justify-content` to
         * distribute and it is inert.
         */
        <ul className="grid grid-cols-1 justify-items-center gap-3 @lg:grid-cols-2">
          {ALL_PROVIDERS.map((provider) => (
            <ProviderRow
              key={provider}
              provider={provider}
              account={accountFor(accounts, provider)}
              announce={announce}
              onLinked={returnFocus}
              onUnlinkRequest={() => {
                setUnlinkError(null);
                setUnlinking(provider);
              }}
            />
          ))}
        </ul>
      )}

      {/* 🚨 KEPT MOUNTED, `open` is the only thing that moves — like every other caller.
          Unmounting the dialog instead of closing it RIPS the `<dialog>` out of the top layer:
          the platform then has no element left to restore focus to, and cancelling drops a
          keyboard user on `<body>`, back at the top of the page. */}
      <ConfirmDialog
        open={unlinking !== null}
        title={unlinking ? `Unlink ${providerLabel(unlinking)}?` : 'Unlink this account?'}
        description={
          <>
            You will not be able to be fielded in a match on any{' '}
            <strong className="text-text-primary">
              {unlinking ? providerLabel(unlinking) : ''}
            </strong>{' '}
            ladder until you link an account again. Matches you have already played are not
            affected.
          </>
        }
        confirmLabel="Unlink"
        pending={unlinkAccount.isPending}
        error={unlinkError}
        onConfirm={() => void handleUnlink()}
        onCancel={() => {
          setUnlinking(null);
          setUnlinkError(null);
        }}
        returnFocusRef={headingRef}
      />
    </div>
  );
}

type ProviderRowProps = {
  provider: RequiredProvider;
  /** The linked row, or `undefined` when this provider is not linked. */
  account: ExternalAccount | undefined;
  announce: (message: string) => void;
  /** Focus goes back to the section heading — the form that held it is being unmounted. */
  onLinked: () => void;
  onUnlinkRequest: () => void;
};

/**
 * One provider: either what is linked plus a way out, or a field and a way in.
 *
 * ⚠️ EACH ROW OWNS ITS FORM STATE. Sharing one `useForm` across the four would mean typing a
 * Steam ID and watching it appear under Riot — and a failure on one row wiping the message of
 * another. The cost is four hook instances, which is nothing; the alternative is a class of
 * bug that only shows up when somebody links two accounts in a row.
 */
function ProviderRow({ provider, account, announce, onLinked, onUnlinkRequest }: ProviderRowProps) {
  const name = providerLabel(provider);
  const linkAccount = useLinkAccount();
  const [submitError, setSubmitError] = useState<string | null>(null);
  /**
   * `useId` and not `id={provider}`: the id has to be unique in the whole DOCUMENT, and this
   * page already has a `<dialog>` and four other sections. React guarantees uniqueness here,
   * and the `<label htmlFor>` is what makes the field reachable by name — without it a screen
   * reader announces "edit text, blank".
   */
  const fieldId = useId();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LinkAccountFormValues>({
    resolver: zodResolver(linkAccountSchema),
    defaultValues: { externalId: '' },
  });

  async function onSubmit(values: LinkAccountFormValues) {
    setSubmitError(null);
    try {
      await linkAccount.mutateAsync({
        provider,
        externalId: values.externalId,
      });
      reset({ externalId: '' });
      announce(`${name} account linked.`);
      onLinked();
    } catch (err) {
      setSubmitError(linkAccountErrorMessage(err, name));
    }
  }

  return (
    /**
     * `w-full max-w-[35ch]`: fill the cell, never exceed 35 characters. The width cap lives HERE
     * and nowhere else — the column count is declared by the `<ul>` grid, so the two settings no
     * longer fight each other.
     *
     * ⚠️ `w-full` is REQUIRED alongside the grid's `justify-items-center`: without it a cell
     * centres its content at its INTRINSIC width, and rows would take different widths depending
     * on the length of the id they carry.
     *
     * `min-w-0`: without it the intrinsic minimum width of the content (a 30-character id with no
     * space to break at) stops the element shrinking below its cell, and the row overflows at
     * 320px.
     */
    <li className="w-full min-w-0 max-w-[35ch] rounded-control border border-border-subtle px-4 py-3">
      <div className="flex flex-col gap-2">
        {/**
         * 🔑 THE PROVIDER NAME DOES NOT MOVE BETWEEN THE TWO STATES: linking an account replaces
         * the input area and nothing else, so the eye does not lose the row it was reading.
         *
         * ⚠️ The element changes NATURE, not appearance. `<label htmlFor>` needs a control to
         * point at; once linked there is no field, and a `for` pointing at nothing is invalid
         * HTML that Chrome reports. Hence the `<span>` dressed by `labelClasses()`, the helper
         * meant for elements that must NOT be a `<label>` (see `ui/label-variants.ts`).
         *
         * Both branches take their size from the SAME constant — styling only one of them would
         * shift the name by a few pixels at the exact moment an account is linked.
         */}
        {account ? (
          <span className={labelClasses(PROVIDER_NAME_SIZE)}>{name}</span>
        ) : (
          <Label htmlFor={fieldId} className={PROVIDER_NAME_SIZE}>
            {name}
          </Label>
        )}

        {account ? (
          /* `h-12`: the EXACT height of an `Input`, so both states take the same room and two
             neighbouring columns in different states stay aligned. */
          <div className="flex h-12 items-center gap-2">
            {/**
             * `text-base` and NOT `text-sm`: every VALUE on /profile is 16px (the bio, the email,
             * the sign-in method, the 2FA state), and a linked id is a value of the same kind.
             *
             * ⚠️ Do not conclude that the label above (12px) or the input (14px) should follow —
             * those belong to the FORM idiom, shared with `PasswordChange` and `ui/input.tsx`.
             * This section is the only one carrying both idioms at once.
             *
             * `break-all`: an id is an opaque string with no space to break at, and 30 characters
             * overflow a 320px column otherwise.
             */}
            <span className="min-w-0 flex-1 break-all text-base text-text-primary">
              {account.externalId}
            </span>
            {/* The provider name is in the accessible label, not only in the visible text: out
                of context, several "Unlink" buttons are indistinguishable in the list a screen
                reader builds. */}
            <Button variant="secondary" aria-label={`Unlink ${name}`} onClick={onUnlinkRequest}>
              Unlink
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-2">
            {/* `items-start` and not `items-center`: the button must stay aligned with the top
                of the field when an error message lengthens the column. */}
            <div className="flex flex-wrap items-start gap-2">
              <Input
                id={fieldId}
                // `min-w-0`: without it the field's intrinsic minimum width stops `flex-wrap`
                // moving the button to the next line, and the row overflows at 320px.
                className="min-w-0 flex-1"
                placeholder={`Your ${name} ID`}
                autoComplete="off"
                disabled={isSubmitting}
                {...register('externalId')}
                aria-invalid={errors.externalId ? true : undefined}
              />
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Linking…' : 'Link'}
              </Button>
            </div>
            {errors.externalId && <FormMessage>{errors.externalId.message}</FormMessage>}
            {submitError && <FormMessage>{submitError}</FormMessage>}
          </form>
        )}
      </div>
    </li>
  );
}
