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
 * In-game accounts section of /profile: link and unlink.
 *
 * the input is offered straight away instead of hiding behind a button like PasswordChange,
 * because this gates the central feature: validateSide() refuses a line-up holding a player
 * with no row in user_external_accounts, and the /home reminder sends people here for it.
 * the link is DECLARATIVE — the server stores the string and always sets verified: false. no
 * tick, no badge, no "verified" anywhere on this screen.
 * one dialog for all rows (one unlinking provider, one pending flag, one error) so its open
 * state can't drift from the row it belongs to.
 */

/** Size of the provider name, shared by BOTH states of a row. */
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
   * unmounts its own button — so focus would land on `<body>` and throw a keyboard user back to
   * the top of the page.
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
        /**
         * The section stands in for itself rather than replacing the page: the other four
         * sections of /profile are perfectly usable while this one is unreachable.
         */
        <Callout tone="danger">
          Your linked accounts could not be loaded. Reload the page to try again.
        </Callout>
      ) : (
        /**
         * A list, not a stack of <div>s: a screen reader announces the item count and lets its
         * user step through them, which is the whole question this section answers.
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

/** One provider: either what is linked plus a way out, or a field and a way in. */
function ProviderRow({ provider, account, announce, onLinked, onUnlinkRequest }: ProviderRowProps) {
  const name = providerLabel(provider);
  const linkAccount = useLinkAccount();
  const [submitError, setSubmitError] = useState<string | null>(null);
  /**
   * `useId` and not `id={provider}`: the id has to be unique in the whole DOCUMENT, and this
   * page already has a `<dialog>` and four other sections.
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
    /** `w-full max-w-[35ch]`: fill the cell, never exceed 35 characters. */
    <li className="w-full min-w-0 max-w-[35ch] rounded-control border border-border-subtle px-4 py-3">
      <div className="flex flex-col gap-2">

        {account ? (
          <span className={labelClasses(PROVIDER_NAME_SIZE)}>{name}</span>
        ) : (
          <Label htmlFor={fieldId} className={PROVIDER_NAME_SIZE}>
            {name}
          </Label>
        )}

        {account ? (
          /**
           * `h-12`: the EXACT height of an `Input`, so both states take the same room and two
           * neighbouring columns in different states stay aligned.
           */
          <div className="flex h-12 items-center gap-2">

            <span className="min-w-0 flex-1 break-all text-base text-text-primary">
              {account.externalId}
            </span>

            <Button variant="secondary" aria-label={`Unlink ${name}`} onClick={onUnlinkRequest}>
              Unlink
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-2">

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
