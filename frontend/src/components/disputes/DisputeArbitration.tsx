import { useId, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormMessage } from '@/components/ui/form-message';
import { Label } from '@/components/ui/label';
import { OptionTile } from '@/components/ui/option-tile';
import { SectionTitle } from '@/components/ui/section-title';
import { labelClasses } from '@/components/ui/label-variants';
import { DISPUTE_WINDOW_HOURS, disputeMsLeft } from '@/lib/dispute-detail';
import {
  RESOLUTION_NOTES_MAX,
  isDisputeSettledElsewhere,
  resolveDisputeErrorMessage,
  useResolveDispute,
} from '@/lib/dispute-mutations';
import { isSoloMatch, sideName } from '@/lib/match-detail';
import { useIsAdmin } from '@/lib/admin-disputes';

import type { RefObject } from 'react';
import type { DisputeFile, DisputeSide } from '@/lib/dispute-detail';
import type { DisputeResolution, ResolveDisputeVariables } from '@/lib/dispute-mutations';

/**
 * The three outcomes the route accepts, as a closed list the screen can iterate.
 *
 * The ORDER is the one an arbiter thinks in — the two camps first, "I cannot separate them"
 * last — and it happens to match the enum's own order, which keeps `side_0_wins` next to the
 * camp whose `sideIndex` is 0. Never reorder without re-reading that mapping.
 */
const RESOLUTIONS: readonly DisputeResolution[] = ['side_0_wins', 'side_1_wins', 'cancelled'];

function isResolution(value: string): value is DisputeResolution {
  return (RESOLUTIONS as readonly string[]).includes(value);
}

/** What the arbitration form holds. */
const arbitrationSchema = z
  .object({
    resolution: z.string().min(1, 'Pick what happens to this match.'),
    notes: z
      .string()
      .trim()
      .max(RESOLUTION_NOTES_MAX, `Keep the note under ${RESOLUTION_NOTES_MAX} characters.`),
  })
  .superRefine((values, ctx) => {
    // Unreachable from the radio group; reachable the day the control changes, and it is the
    // exact rule the API answers 400 on.
    if (values.resolution !== '' && !isResolution(values.resolution)) {
      ctx.addIssue({
        code: 'custom',
        path: ['resolution'],
        message: 'Pick one of the three outcomes.',
      });
    }
  });

type ArbitrationFormValues = z.infer<typeof arbitrationSchema>;

/** What the live region says when the file was settled while this tab sat open. */
const SETTLED_ELSEWHERE_ANNOUNCEMENT =
  'This dispute has just been settled — by another admin, or by the 24-hour job. The file is now read-only.';

type DisputeArbitrationProps = {
  file: DisputeFile;
  /** Fresh clock from the page — the 24 h window must still be open. */
  nowMs: number;
  /** Where focus goes once this panel disappears (it does, on every success): the page's `<h1>`. */
  returnFocusRef: RefObject<HTMLElement | null>;
  /** Hands the page the sentence to put in its ONE live region, AND lands the focus. */
  onSettled: (announcement: string) => void;
};

/** Names one camp, or says which one it is when the payload does not carry it. */
function campName(sides: DisputeSide[], sideIndex: 0 | 1, solo: boolean) {
  const side = sides.find((candidate) => candidate.sideIndex === sideIndex);
  if (side) return sideName(side, solo);
  // The contract types `sides` as a list, so "fewer than two" is representable even though a
  // dispute cannot exist without both camps having reported.
  return sideIndex === 0 ? 'The first camp' : 'The second camp';
}

/** The arbiter's controls — the ONLY exit from `disputed` other than the 24 h job. */
export function DisputeArbitration({
  file,
  nowMs,
  returnFocusRef,
  onSettled,
}: DisputeArbitrationProps) {
  const notesId = useId();
  const notesHintId = useId();
  const notesErrorId = useId();
  const resolutionHintId = useId();
  const resolutionErrorId = useId();

  /** The ruling the arbiter has filled in and asked to send — `null` when no dialog is open. */
  const [staged, setStaged] = useState<ResolveDisputeVariables | null>(null);

  const isAdmin = useIsAdmin();
  // Hooks run on every render, so all of them are created before any branch below.
  const resolve = useResolveDispute(file.dispute.id);
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ArbitrationFormValues>({
    resolver: zodResolver(arbitrationSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { resolution: '', notes: '' },
  });

  // `useWatch`, never the form's `watch()`: the latter is flagged by
  // react-hooks/incompatible-library (it defeats the compiler's memoization).
  const picked = useWatch({ control, name: 'resolution' });

  const solo = isSoloMatch(file.match);
  const sides = file.sides;
  const firstCamp = campName(sides, 0, solo);
  const secondCamp = campName(sides, 1, solo);

  /** What each outcome DOES — the arbiter must not have to guess which one moves Elo. */
  const outcomes: { value: DisputeResolution; label: string; effect: string }[] = [
    {
      value: 'side_0_wins',
      label: `${firstCamp} wins`,
      effect: 'The match closes as a win and Elo is applied to both camps.',
    },
    {
      value: 'side_1_wins',
      label: `${secondCamp} wins`,
      effect: 'The match closes as a win and Elo is applied to both camps.',
    },
    {
      value: 'cancelled',
      label: 'Cancel the match',
      effect: 'The match counts for nothing. No Elo moves for either camp.',
    },
  ];

  const stagedOutcome = staged ? outcomes.find((o) => o.value === staged.resolution) : undefined;

  function settle(ruling: ResolveDisputeVariables) {
    // `mutate`, not `mutateAsync`: a rejection lands in `resolve.error` and is rendered inside
    // the dialog, so no promise is left unhandled in this handler.
    resolve.mutate(ruling, {
      onSuccess: () => {
        const outcome = outcomes.find((o) => o.value === ruling.resolution);
        // Closing FIRST: by the time this runs the invalidation has already landed, so the
        // button that opened the dialog is gone from the DOM — `ConfirmDialog` then falls back
        // to `returnFocusRef` instead of leaving focus on `<body>`.
        setStaged(null);
        onSettled(
          `Dispute settled: ${outcome?.label ?? ruling.resolution}. ${outcome?.effect ?? ''} The file is now read-only.`,
        );
      },
      /**
       * The 409 ALONE closes the dialog. Everything else stays on screen and reads normally
       * inside it.
       */
      onError: (error) => {
        if (isDisputeSettledElsewhere(error)) {
          setStaged(null);
          onSettled(SETTLED_ELSEWHERE_ANNOUNCEMENT);
        }
      },
    });
  }

  const onSubmit = handleSubmit((values) => {
    // Narrowed, never cast: `isResolution` is what turns the raw radio value into the enum the
    // request body declares.
    if (!isResolution(values.resolution)) return;

    const notes = values.notes.trim();
    // The key is OMITTED rather than sent empty: the field is optional on the route, and an
    // empty string would be stored as a note that says nothing.
    setStaged({ resolution: values.resolution, ...(notes ? { notes } : {}) });
  });

  // The ONLY early return, and it is on the one condition that cannot change under the user:
  // see the docblock on why the dialog must never be unmounted while open.
  if (!isAdmin) return null;

  const resolutionError = errors.resolution?.message;
  const notesError = errors.notes?.message;

  function panel() {
    // Already settled — by an arbiter or by the job. `DisputeVerdict` at the top of the page
    // says so; a form here would be a request the API answers 409.
    if (file.dispute.status !== 'open') return null;

    const left = disputeMsLeft(file.dispute, nowMs);
    if (left !== null && left <= 0) {
      return (
        <section className="flex min-w-0 flex-col gap-3.5">
          <SectionTitle>Arbitration</SectionTitle>

          <Callout tone="muted">
            The {DISPUTE_WINDOW_HOURS}-hour window has run out, so this dispute can no longer be
            settled by hand: the match is about to be cancelled automatically, and no Elo will be
            applied to either camp.
          </Callout>
        </section>
      );
    }

    return (
      <section className="flex min-w-0 flex-col gap-3.5">
        <SectionTitle>Arbitration</SectionTitle>

        <p className="max-w-prose text-sm text-text-secondary">
          You are settling this file. Naming a camp closes the match as a win and{' '}
          <strong className="text-text-primary">applies Elo to both sides</strong>; cancelling it
          leaves every rating untouched.{' '}
          <strong className="text-text-primary">The decision is final</strong> — a settled dispute
          cannot be reopened.
        </p>

        <form onSubmit={onSubmit} noValidate className="flex min-w-0 flex-col gap-5">
          <fieldset
            // `fieldset` maps to role="group", which does take a description: the hint and the
            // failure are announced with the group instead of floating loose next to it.
            aria-describedby={
              resolutionError ? `${resolutionHintId} ${resolutionErrorId}` : resolutionHintId
            }
            className="flex min-w-0 flex-col gap-2 border-0 p-0"
          >

            <legend className={labelClasses('mb-2')}>Outcome</legend>

            <div className="flex flex-col gap-2">
              {outcomes.map((outcome) => (
                <OptionTile key={outcome.value} selected={picked === outcome.value}>
                  <input
                    type="radio"
                    value={outcome.value}
                    // Marked on the CONTROLS, not just described on the group: without it a
                    // screen reader reads the reason (through the fieldset) but never says
                    // which control is refused.
                    aria-invalid={Boolean(resolutionError)}
                    disabled={resolve.isPending}
                    className="focus-ring size-4 shrink-0 accent-action-primary"
                    {...register('resolution')}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-bold text-text-primary">
                      {outcome.label}
                    </span>
                    <span className="text-xs text-text-secondary">{outcome.effect}</span>
                  </span>
                </OptionTile>
              ))}
            </div>

            <p id={resolutionHintId} className="text-xs text-text-muted">
              Both camps see this decision on the file.
            </p>
          </fieldset>

          {resolutionError ? (
            <FormMessage id={resolutionErrorId}>{resolutionError}</FormMessage>
          ) : null}

          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor={notesId}>Note (optional)</Label>
            <textarea
              id={notesId}
              rows={3}
              aria-invalid={Boolean(notesError)}
              // Without this, a screen reader announces "invalid" and stops there: the reason
              // sits in an element nothing points at.
              aria-describedby={notesError ? `${notesHintId} ${notesErrorId}` : notesHintId}
              disabled={resolve.isPending}
              className="focus-ring min-w-0 rounded-control border border-border-control bg-surface-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-50"
              {...register('notes')}
            />
            <p id={notesHintId} className="text-xs text-text-muted">
              Up to {RESOLUTION_NOTES_MAX} characters, shown to both camps. Say what in the thread
              decided it — this is all they will get.
            </p>
            {notesError ? <FormMessage id={notesErrorId}>{notesError}</FormMessage> : null}
          </div>

          <Button type="submit" disabled={resolve.isPending} className="w-fit">
            Settle this dispute
          </Button>
        </form>
      </section>
    );
  }

  return (
    <>
      {panel()}

      <ConfirmDialog
        open={staged !== null}
        title="Settle this dispute?"
        description={
          <>
            <strong className="text-text-primary">{stagedOutcome?.label}</strong>{' '}
            {stagedOutcome?.effect} Both camps are released and the file becomes read-only. This
            cannot be undone.
          </>
        }
        confirmLabel="Settle it"
        cancelLabel="Not yet"
        // `danger`: it closes somebody else's match for good, and one of the three outcomes
        // wipes the game off both records.
        tone="danger"
        pending={resolve.isPending}
        error={resolve.isError ? resolveDisputeErrorMessage(resolve.error) : null}
        onConfirm={() => (staged ? settle(staged) : undefined)}
        onCancel={() => {
          resolve.reset();
          setStaged(null);
        }}
        returnFocusRef={returnFocusRef}
      />
    </>
  );
}
