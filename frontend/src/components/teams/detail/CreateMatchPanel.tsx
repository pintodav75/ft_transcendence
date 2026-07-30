import { useEffect, useId, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { FormMessage } from '@/components/ui/form-message';
import { Label } from '@/components/ui/label';
import { OptionTile } from '@/components/ui/option-tile';
import { Select } from '@/components/ui/select';
import { labelClasses } from '@/components/ui/label-variants';
import { createMatchErrorMessage, isExpiredSlotError, useCreateMatch } from '@/lib/match-mutations';
import { createMatchSchema } from '@/lib/create-match-schema';
import { providerLabel, useLadders } from '@/lib/games';
import { teamMatchesKey } from '@/lib/team-detail';
import {
  MAX_OPEN_SLOTS,
  conflictsWithEngagement,
  engagementTimes,
  openSlotCount,
  slotDays,
  slotTimes,
} from '@/lib/match-slots';
import { EM_DASH } from '@/lib/utils';

import type { CreateMatchFormValues } from '@/lib/create-match-schema';
import type { TeamDetail, TeamMatch, TeamMember } from '@/lib/team-detail';

type CreateMatchPanelProps = {
  /** Target of the opener's `aria-controls`. */
  id: string;
  team: TeamDetail;
  members: TeamMember[];
  /** The team's history — `undefined` while it loads. Feeds BOTH pre-emptions below. */
  matches: TeamMatch[] | undefined;
  /** Called with the ISO instant of the slot that was just opened. */
  onCreated: (scheduledAt: string) => void;
  onClose: () => void;
};

/**
 * Captain's slot opener: an inline DISCLOSURE panel, not a modal.
 *
 * `ConfirmDialog` is a confirmation box, not a form container — a native `<dialog>` holding
 * a nine-field form would trap focus around a task the user may well want to abandon
 * halfway. The panel sits between the header and the tab strip, and the button that opened
 * it carries `aria-expanded`.
 *
 * ⚠️ THERE IS NO 1v1 PATH HERE. `POST /matches` describes a solo mode with no line-up, but a
 * team cannot exist on a 1v1 ladder (`routes/teams.ts` refuses it in 400), so `team.format`
 * is always 2v2/3v3/5v5 and the line-up is always required. Solo will get its own page.
 */
export function CreateMatchPanel({
  id,
  team,
  members,
  matches,
  onCreated,
  onClose,
}: CreateMatchPanelProps) {
  const headingId = useId();
  const dayId = useId();
  const timeId = useId();
  const dayErrorId = useId();
  const timeHintId = useId();
  const timeErrorId = useId();
  const lineupHintId = useId();
  const lineupErrorId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  /**
   * "Now", frozen when the panel opens rather than read at every render — a moving `now`
   * would silently drop the option the captain is about to click. It is refreshed on the one
   * event that proves it went stale: the 400 saying the slot just passed.
   */
  const [nowMs, setNowMs] = useState(() => Date.now());

  const createMatch = useCreateMatch(teamMatchesKey(team.id));
  const laddersQuery = useLadders();
  const ladder = laddersQuery.data?.ladders.find((entry) => entry.id === team.ladderId);
  const lockoutMinutes = ladder?.lockoutMinutes;

  // A team's format is always 2/3/5 here (see the warning above), so the size is exact.
  const lineupSize = Number.parseInt(team.format, 10);
  // ⚠️ `undefined` (still loading, or the request failed) is NOT the same as an empty
  // history, and `matches ?? []` would flatten the difference: both pre-emptions below would
  // silently switch off — no greyed-out quarter, no cap notice — while the screen kept
  // looking perfectly normal. Unknown stays unknown, and is said out loud.
  const engagements = matches ? engagementTimes(matches, nowMs) : undefined;
  const openSlots = matches ? openSlotCount(matches, nowMs) : undefined;
  const atCap = openSlots !== undefined && openSlots >= MAX_OPEN_SLOTS;
  const fieldable = members.filter((member) => member.hasLinkedAccount).length;

  const days = slotDays(nowMs);
  const firstUsableDay = days.find((day) => slotTimes(day.startMs, nowMs).length > 0) ?? days[0];

  const {
    control,
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<CreateMatchFormValues>({
    // The size never changes for a mounted panel: it comes from the team's ladder.
    resolver: zodResolver(createMatchSchema(lineupSize)),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { day: firstUsableDay?.value ?? '', time: '', lineup: [] },
  });

  // `useWatch`, never the form's `watch()`: the latter is flagged by
  // react-hooks/incompatible-library (it defeats the compiler's memoization).
  const dayValue = useWatch({ control, name: 'day' });
  const timeValue = useWatch({ control, name: 'time' });
  const lineup = useWatch({ control, name: 'lineup' });

  /**
   * Both inputs of the pre-emption, or nothing at all — the ladder's rules AND the team's own
   * schedule are needed to grey a quarter out. Bundling them in ONE object keeps the rule in
   * a single place: the notice below and the `blocked` flag are then two readings of the same
   * decision, and cannot drift apart. Missing either one means nothing is greyed out and the
   * 409 stays the net, which is said out loud further down.
   */
  const preempt =
    lockoutMinutes !== undefined && engagements !== undefined
      ? { lockoutMinutes, engagements }
      : null;

  const times = slotTimes(Number(dayValue), nowMs).map((slot) => ({
    ...slot,
    blocked:
      preempt !== null &&
      conflictsWithEngagement(slot.atMs, preempt.engagements, preempt.lockoutMinutes),
  }));

  const dayField = register('day');

  useEffect(() => {
    // The panel appears BELOW the button that opened it: without this, a keyboard user
    // would Tab through the whole header again to reach the first field.
    headingRef.current?.focus();
  }, []);

  const submit = handleSubmit((values) => {
    // `new Date(y, m, d, h, min, 0, 0)` produced the epoch behind this value — never a
    // hand-built string, which would guess at the time zone. Every UTC offset on Earth is a
    // multiple of 15 min, so a local quarter is always a UTC quarter.
    const scheduledAt = new Date(Number(values.time)).toISOString();

    createMatch.mutate(
      { ladderId: team.ladderId, scheduledAt, lineup: values.lineup },
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

            // FX-MIDNIGHT — la liste des jours vient d'être régénérée à partir de `freshNow`.
            // Si le panneau est resté ouvert AU PASSAGE DE MINUIT, le `day` en mémoire est
            // minuit de la veille : il ne correspond plus à aucune `<option>`. Le menu
            // affichait alors un jour, le formulaire en retenait un autre, et la liste
            // d'heures sortait vide (« No quarter left on this day »).
            // ⚠️ On RECALCULE ici : `days` et `firstUsableDay` du rendu courant sont dérivés
            // de l'ANCIEN `nowMs` (le `setNowMs` ci-dessus ne prend effet qu'au rendu
            // suivant), les réutiliser réécrirait la valeur périmée qu'on veut corriger.
            // ⚠️ On ne remet PAS le jour au premier utilisable de façon inconditionnelle :
            // un capitaine qui avait choisi « dans 3 jours » n'a aucune raison d'être ramené
            // à aujourd'hui parce qu'un quart d'heure vient de passer. On ne touche au
            // champ que s'il désigne un jour qui n'existe plus.
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
    ? createMatchErrorMessage(createMatch.error, { side: 'team', openSlots, members })
    : null;
  const lineupError = errors.lineup?.message;
  const timeError = errors.time?.message;
  const dayError = errors.day?.message;
  const submittable =
    !createMatch.isPending &&
    !laddersQuery.isPending &&
    timeValue !== '' &&
    lineup.length === lineupSize;

  return (
    <section id={id} aria-labelledby={headingId} className="panel flex flex-col gap-5 p-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* `tabIndex={-1}` only so focus can be MOVED here on open; it stays out of the
            tab order afterwards. */}
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="focus-ring text-lg label-caps-black">
          Open a match slot
        </h2>
        <p className="text-xs text-text-muted">
          {openSlots ?? EM_DASH}/{MAX_OPEN_SLOTS} open slots · {team.ladderName}
        </p>
      </div>

      {atCap ? (
        <>
          {/* The 409 stays the real rampart; this only avoids a request whose answer is
              already known — same idiom as the full roster in TeamInvitePlayer. */}
          <Callout tone="muted">
            This team already holds {MAX_OPEN_SLOTS} open slots on this ladder. Cancel one from
            the Matches tab before opening another.
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
                // reason sits in an element nothing points at. Same wiring as every other
                // field of the repo (register, login, TeamIdentity).
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
                // Both the "no quarter left" hint and the error are announced with the
                // field: whichever is on screen is the one that explains it.
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
                  // Present but DISABLED, never removed: a captain who cannot find 21:30
                  // has to be able to see why it is gone.
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

          {laddersQuery.isPending ? (
            <p role="status" className="text-xs text-text-muted">
              Loading this ladder&apos;s rules…
            </p>
          ) : preempt === null ? (
            // Covers BOTH missing inputs: this ladder's rules (`lockoutMinutes`) and this
            // team's own schedule (its match history). The consequence is the same either
            // way, so it gets one honest sentence rather than two near-identical ones.
            <Callout tone="muted">
              {lockoutMinutes === undefined
                ? 'This ladder’s rules could not be loaded, '
                : 'This team’s matches could not be loaded, '}
              so the times it is already committed to are not greyed out, and the count of
              open slots above is unknown. A team can only play one match at a time — the
              server will refuse an overlapping slot.
            </Callout>
          ) : (
            <p className="text-xs text-text-muted">
              Slots sit on fixed quarters, at least 15 minutes ahead. A match blocks the{' '}
              {lockoutMinutes} minutes around it, so the times this team is already committed
              to are greyed out — two matches that merely touch stay allowed.
            </p>
          )}

          <Controller
            control={control}
            name="lineup"
            render={({ field }) => (
              <fieldset
                // `fieldset` maps to role="group", which does take a description: the count
                // and the failure are announced with the group instead of floating loose.
                aria-describedby={
                  lineupError ? `${lineupHintId} ${lineupErrorId}` : lineupHintId
                }
                className="flex min-w-0 flex-col gap-2 border-0 p-0"
              >
                {/* A <legend>, not a <Label>: it names a GROUP of checkboxes, not one
                    control. The look is shared through labelClasses() rather than by
                    copying Label's utility string — same idiom as buttonClasses(). */}
                <legend className={labelClasses('mb-2')}>Line-up</legend>

                <ul role="list" className="grid gap-2 sm:grid-cols-2">
                  {members.map((member) => {
                    const selected = field.value.includes(member.id);
                    // §5.1 — a player with no linked game account cannot be fielded. The
                    // 400 `unlinkedPlayers` is mapped anyway, for the stale-page case.
                    const unlinked = !member.hasLinkedAccount;
                    const atLineupLimit = !selected && field.value.length >= lineupSize;

                    return (
                      <li key={member.id} className="min-w-0">
                        {/* The tile's look moved to `components/ui/option-tile.tsx` at its
                            second use (the match result form): same markup, same classes,
                            one owner. */}
                        <OptionTile selected={selected} disabled={unlinked || atLineupLimit}>
                          <input
                            type="checkbox"
                            className="focus-ring size-4 shrink-0 accent-action-primary"
                            checked={selected}
                            disabled={unlinked || atLineupLimit}
                            onBlur={field.onBlur}
                            onChange={(event) =>
                              field.onChange(
                                event.target.checked
                                  ? [...field.value, member.id]
                                  : field.value.filter((id: string) => id !== member.id),
                              )
                            }
                          />
                          <Avatar
                            src={member.avatarUrl ?? undefined}
                            alt=""
                            fallback={member.pseudo.slice(0, 2).toUpperCase()}
                            className="size-8 shrink-0"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-bold text-text-primary">
                              {member.displayName ?? member.pseudo}
                            </span>
                            <span className="block truncate text-xs text-text-muted">
                              {unlinked
                                ? `no ${providerLabel(team.requiredProvider)} account`
                                : `@${member.pseudo}`}
                            </span>
                          </span>
                        </OptionTile>
                      </li>
                    );
                  })}
                </ul>

                <p id={lineupHintId} className="text-xs text-text-muted">
                  {field.value.length}/{lineupSize} players selected
                  {field.value.length >= lineupSize
                    ? ' — unselect one to swap a player.'
                    : fieldable < lineupSize
                      ? ` — only ${fieldable} of your players have linked their ${providerLabel(team.requiredProvider)} account.`
                      : ''}
                </p>
              </fieldset>
            )}
          />

          {lineupError ? <FormMessage id={lineupErrorId}>{lineupError}</FormMessage> : null}
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
