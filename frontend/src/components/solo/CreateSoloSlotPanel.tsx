import { useEffect, useId, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { FormMessage } from '@/components/ui/form-message';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { createMatchErrorMessage, isExpiredSlotError, useCreateMatch } from '@/lib/match-mutations';
import { myMatchesKey } from '@/lib/solo';
import { soloSlotSchema } from '@/lib/create-match-schema';
import {
  MAX_OPEN_SLOTS,
  conflictsWithEngagement,
  engagementTimes,
  openSlotCount,
  slotDays,
  slotTimes,
} from '@/lib/match-slots';
import { EM_DASH } from '@/lib/utils';

import type { SoloSlotFormValues } from '@/lib/create-match-schema';
import type { SoloMatch } from '@/lib/solo';

type CreateSoloSlotPanelProps = {
  /** Target of the opener's `aria-controls`. */
  id: string;
  ladder: { id: string; name: string; lockoutMinutes: number };
  /** Display name of the account this game requires — used only to phrase the §5.1 refusal. */
  providerName: string;
  /** My history ON THIS LADDER — `undefined` while it loads. Feeds BOTH pre-emptions below. */
  matches: SoloMatch[] | undefined;
  /**
   * La requête d'historique a-t-elle ÉCHOUÉ ? ⚠️ Distinct de `matches === undefined`, qui
   * couvre aussi « encore en cours de chargement » : l'ouvrant n'attend que la requête des
   * comptes liés, alors que `GET /matches/me` est plus lente et retente sur 5xx. Sans ce
   * drapeau, cliquer dans cette fenêtre annonçait une panne qui n'avait pas eu lieu.
   */
  matchesFailed: boolean;
  /** Called with the ISO instant of the slot that was just opened. */
  onCreated: (scheduledAt: string) => void;
  onClose: () => void;
};

/**
 * Solo slot opener: an inline DISCLOSURE panel, not a modal — same idiom as the team's
 * `CreateMatchPanel`, and for the same reason (a `<dialog>` traps focus around a task the
 * user may want to abandon halfway).
 *
 * 🔑 WHY THIS IS A SEPARATE COMPONENT AND NOT A MODE OF `CreateMatchPanel` (decision taken
 * with David, 30/07): what must never diverge between the two screens are the RULES — the
 * quarter grid, the 15-minute lead, the overlap detection and the cap of five. Those are
 * shared, in `lib/match-slots.ts`, and neither file owns a copy. What legitimately differs is
 * the FORM: there is no line-up here, no roster, no player tiles, no captain. Generalising
 * 410 lines of team JSX to grow an "optional line-up" would have rewritten a component
 * guarded by a 532-line audit scenario and merged the same week, to share markup the two
 * screens do not actually have in common.
 *
 * ⚠️ NO LINE-UP IS SENT AT ALL. `POST /matches` ignores `lineup` in 1v1 (the caller IS the
 * side), and `lineup: []` would be REFUSED in 400 — the field is `min(1).optional()`, so
 * "absent" and "empty" are not the same thing to the server.
 *
 * ⚠️ THIS PANEL ASSUMES THE ACCOUNT IS LINKED. §5.1 is not re-checked here: the page does not
 * render the opener at all without a linked account, because a `POST` bound for a 400 writes
 * a red line in the Chrome console. The 400 is still mapped below, for the page left open
 * while the account was unlinked elsewhere.
 */
export function CreateSoloSlotPanel({
  id,
  ladder,
  providerName,
  matches,
  matchesFailed,
  onCreated,
  onClose,
}: CreateSoloSlotPanelProps) {
  const headingId = useId();
  const dayId = useId();
  const timeId = useId();
  const dayErrorId = useId();
  const timeHintId = useId();
  const timeErrorId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  /**
   * "Now", frozen when the panel opens rather than read at every render — a moving `now`
   * would silently drop the option the user is about to click. It is refreshed on the one
   * event that proves it went stale: the 400 saying the slot just passed.
   */
  const [nowMs, setNowMs] = useState(() => Date.now());

  const createMatch = useCreateMatch(myMatchesKey(ladder.id));

  // ⚠️ `undefined` (still loading, or the request failed) is NOT the same as an empty history,
  // and `matches ?? []` would flatten the difference: both pre-emptions below would silently
  // switch off — no greyed-out quarter, no cap notice — while the screen kept looking normal.
  // Unknown stays unknown, and is said out loud.
  const engagements = matches ? engagementTimes(matches, nowMs) : undefined;
  const openSlots = matches ? openSlotCount(matches, nowMs) : undefined;
  const atCap = openSlots !== undefined && openSlots >= MAX_OPEN_SLOTS;

  const days = slotDays(nowMs);
  const firstUsableDay = days.find((day) => slotTimes(day.startMs, nowMs).length > 0) ?? days[0];

  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<SoloSlotFormValues>({
    resolver: zodResolver(soloSlotSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { day: firstUsableDay?.value ?? '', time: '' },
  });

  // `useWatch`, never the form's `watch()`: the latter is flagged by
  // react-hooks/incompatible-library (it defeats the compiler's memoization).
  const dayValue = useWatch({ control, name: 'day' });
  const timeValue = useWatch({ control, name: 'time' });

  // ⚠️ Unlike the team panel, `lockoutMinutes` is NEVER missing here: it comes from
  // `GET /ladders/{id}`, which this page has already loaded before rendering the opener (the
  // team page only has the ladder's id, hence its extra `useLadders()` lookup and its
  // "rules could not be loaded" branch). So the only unknown left is my own history.
  const times = slotTimes(Number(dayValue), nowMs).map((slot) => ({
    ...slot,
    blocked:
      engagements !== undefined &&
      conflictsWithEngagement(slot.atMs, engagements, ladder.lockoutMinutes),
  }));

  const dayField = register('day');

  useEffect(() => {
    // The panel appears BELOW the button that opened it: without this, a keyboard user would
    // Tab through the whole header again to reach the first field.
    headingRef.current?.focus();
  }, []);

  const submit = handleSubmit((values) => {
    // `new Date(y, m, d, h, min, 0, 0)` produced the epoch behind this value — never a
    // hand-built string, which would guess at the time zone. Every UTC offset on Earth is a
    // multiple of 15 min, so a local quarter is always a UTC quarter.
    const scheduledAt = new Date(Number(values.time)).toISOString();

    createMatch.mutate(
      // No `lineup` key at all — see the docblock.
      { ladderId: ladder.id, scheduledAt },
      {
        onSuccess: () => onCreated(scheduledAt),
        onError: (error) => {
          // The chosen quarter slipped under the 15-minute bound while the panel sat open.
          // Showing the message without redrawing the list would let the next click fail
          // exactly the same way.
          if (isExpiredSlotError(error)) {
            const freshNow = Date.now();
            setNowMs(freshNow);
            setValue('time', '');

            // FX-MIDNIGHT — if the panel stayed open ACROSS MIDNIGHT, the remembered `day` is
            // yesterday's midnight and matches no `<option>` any more: the menu showed one day
            // while the form held another, and the time list came out empty.
            // ⚠️ RECOMPUTED here: `days`/`firstUsableDay` of the current render derive from the
            // OLD `nowMs` (the `setNowMs` above only takes effect next render), so reusing them
            // would write back the very stale value we are fixing.
            // ⚠️ The day is NOT reset unconditionally: someone who picked "in 3 days" has no
            // reason to be dragged back to today because a quarter of an hour went by.
            const freshDays = slotDays(freshNow);
            const stillListed = freshDays.some((day) => day.value === getValues('day'));
            if (!stillListed) {
              const usable =
                freshDays.find((day) => slotTimes(day.startMs, freshNow).length > 0) ??
                freshDays[0];
              setValue('day', usable?.value ?? '');
            }
          }
        },
      },
    );
  });

  const serverError = createMatch.isError
    ? createMatchErrorMessage(createMatch.error, { side: 'solo', openSlots, providerName })
    : null;
  const timeError = errors.time?.message;
  const dayError = errors.day?.message;
  const submittable = !createMatch.isPending && timeValue !== '';

  return (
    <section id={id} aria-labelledby={headingId} className="panel flex flex-col gap-5 p-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* `tabIndex={-1}` only so focus can be MOVED here on open; it stays out of the tab
            order afterwards. */}
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="focus-ring text-lg label-caps-black"
        >
          Open a match slot
        </h2>
        <p className="text-xs text-text-muted">
          {openSlots ?? EM_DASH}/{MAX_OPEN_SLOTS} open slots · {ladder.name}
        </p>
      </div>

      {atCap ? (
        <>
          {/* The 409 stays the real rampart; this only avoids a request whose answer is
              already known. */}
          <Callout tone="muted">
            You already hold {MAX_OPEN_SLOTS} open slots on this ladder. Cancel one from the
            Matches tab before opening another.
          </Callout>
          <div className="flex">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor={dayId}>Day</Label>
              <Select
                id={dayId}
                aria-invalid={Boolean(dayError)}
                // Without this, a screen reader announces "invalid" and stops there: the
                // reason sits in an element nothing points at.
                aria-describedby={dayError ? dayErrorId : undefined}
                {...dayField}
                onChange={(event) => {
                  void dayField.onChange(event);
                  // The quarters of the previous day are gone from the list: keeping the old
                  // value would submit an instant nobody can see on screen.
                  setValue('time', '');
                }}
              >
                {days.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.label}
                  </option>
                ))}
              </Select>
              {dayError ? <FormMessage id={dayErrorId}>{dayError}</FormMessage> : null}
            </div>

            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor={timeId}>Kick-off</Label>
              <Select
                id={timeId}
                aria-invalid={Boolean(timeError)}
                // Both the "no quarter left" hint and the error are announced with the field:
                // whichever is on screen is the one that explains it.
                aria-describedby={
                  [times.length === 0 ? timeHintId : null, timeError ? timeErrorId : null]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                disabled={times.length === 0}
                {...register('time')}
              >
                <option value="">Pick a time…</option>
                {times.map((slot) => (
                  // Present but DISABLED, never removed: someone who cannot find 21:30 has to
                  // be able to see why it is gone.
                  <option key={slot.value} value={slot.value} disabled={slot.blocked}>
                    {slot.label}
                    {slot.blocked ? ' — already engaged' : ''}
                  </option>
                ))}
              </Select>
              {times.length === 0 ? (
                <p id={timeHintId} className="text-xs text-text-muted">
                  No quarter left on this day — pick another one.
                </p>
              ) : null}
              {timeError ? <FormMessage id={timeErrorId}>{timeError}</FormMessage> : null}
            </div>
          </div>

          {engagements === undefined ? (
            <Callout tone="muted">
              {matchesFailed
                ? 'Your matches on this ladder could not be loaded, so the times you are already committed to are not greyed out, and the count of open slots above is unknown. You can only play one match at a time — the server will refuse an overlapping slot.'
                : 'Still loading your matches on this ladder, so the times you are already committed to are not greyed out yet. You can only play one match at a time — the server will refuse an overlapping slot.'}
            </Callout>
          ) : (
            <p className="text-xs text-text-muted">
              Slots sit on fixed quarters, at least 15 minutes ahead. A match blocks the{' '}
              {ladder.lockoutMinutes} minutes around it, so the times you are already committed
              to on this ladder are greyed out — two matches that merely touch stay allowed.
            </p>
          )}

          {serverError ? <FormMessage>{serverError}</FormMessage> : null}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={!submittable}>
              {createMatch.isPending ? 'Opening the slot…' : 'Open the slot'}
            </Button>
            <Button variant="secondary" disabled={createMatch.isPending} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
