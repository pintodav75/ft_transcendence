import { useId, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { EvidencePicker } from '@/components/disputes/EvidencePicker';
import { FormMessage } from '@/components/ui/form-message';
import { Label } from '@/components/ui/label';
import { SectionTitle } from '@/components/ui/section-title';
import { canSubmitEvidence } from '@/lib/dispute-detail';
import { isDisputeSettledElsewhere, submitEvidenceErrorMessage, useSubmitEvidence } from '@/lib/dispute-mutations';
import { isSoloMatch, sideName } from '@/lib/match-detail';
import { useAuthStore } from '@/stores/auth-store';

import type { DisputeFile } from '@/lib/dispute-detail';

/**
 * The message that goes with the attachment.
 *
 * MIRROR OF THE SERVER, NOT A STRICTER VERSION. `POST /disputes/{id}/evidence` trims the field
 * and answers 400 `message required` on an empty one — that is the whole rule, and in particular
 * there is NO maximum length. Adding one here would refuse something the API accepts, which is
 * the failure mode a mirror exists to avoid.
 */
const evidenceSchema = z.object({
  message: z.string().trim().min(1, 'Say what this file shows — an admin reads it to decide.'),
});

type EvidenceFormValues = z.infer<typeof evidenceSchema>;

/** What the live region says once the server has answered. */
const FILED_ANNOUNCEMENT = 'Evidence filed. It now appears at the end of the thread above.';

/** What the live region says when the dispute is settled while this tab sits open. */
const SETTLED_ELSEWHERE_ANNOUNCEMENT =
  'This dispute has just been settled, so it no longer accepts evidence. The file is now read-only.';

type EvidenceFormProps = {
  file: DisputeFile;
  /** Fresh clock from the page — the 24 h window must still be open for the API to accept. */
  nowMs: number;
  /** Hands the page the sentence to put in its ONE live region. */
  onFiled: (announcement: string) => void;
  /**
   * The dispute was settled while this tab sat open (409): this panel is about to unmount under
   * the user, so the page has to announce it AND land the focus somewhere sensible — `<body>`
   * throws a keyboard user back to the top of the document with nothing said.
   */
  onSettledElsewhere: (announcement: string) => void;
};

/** Files one piece of evidence: a file AND a message, in a single request. */
export function EvidenceForm({
  file,
  nowMs,
  onFiled,
  onSettledElsewhere,
}: EvidenceFormProps) {
  const messageId = useId();
  const messageHintId = useId();
  const messageErrorId = useId();
  const attachmentErrorId = useId();
  const attachmentHintId = useId();

  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const meId = useAuthStore((state) => state.user?.id);
  // Hooks run on every render, so both are created before any branch below.
  const submit = useSubmitEvidence(file.dispute.id, setUploadProgress);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EvidenceFormValues>({
    resolver: zodResolver(evidenceSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { message: '' },
  });

  const { mySide, blocker } = canSubmitEvidence(file, meId, nowMs);

  const onSubmit = handleSubmit((values) => {
    // The attachment is mandatory and is NOT an RHF field (a `File` is not a form value we can
    // round-trip through a resolver): the requirement is stated here, next to the control, and
    // rendered under it — never enforced by a disabled button with no explanation.
    if (!attachment) {
      setAttachmentError('Attach the screenshot or PDF that backs up your version.');
      return;
    }

    setAttachmentError(null);
    // `0` rather than `null`: the bar exists from the very first byte, instead of appearing
    // once the first progress event lands.
    setUploadProgress(0);

    // `mutate`, not `mutateAsync`: a rejection lands in `submit.error` and is rendered below,
    // so no promise is left unhandled in this handler.
    submit.mutate(
      { file: attachment, message: values.message.trim() },
      {
        onSuccess: () => {
          reset({ message: '' });
          setAttachment(null);
          /** NO FOCUS MOVE HERE, and it is deliberate. */
          onFiled(FILED_ANNOUNCEMENT);
        },
        // The 409 alone: its refetch turns the file read-only and unmounts this panel, so the
        // message rendered below would flash and vanish unread. Everything else stays on
        // screen.
        onError: (error) => {
          if (isDisputeSettledElsewhere(error)) onSettledElsewhere(SETTLED_ELSEWHERE_ANNOUNCEMENT);
        },
        onSettled: () => setUploadProgress(null),
      },
    );
  });

  // Settled file, or someone who does not speak for a camp: no section at all. The verdict
  // block at the top of the page already says the file is closed.
  if (blocker === 'settled' || blocker === 'not_a_party' || !mySide) return null;

  const solo = isSoloMatch(file.match);
  const myName = sideName(mySide, solo);

  if (blocker === 'window_closed') {
    return (
      <section className="flex min-w-0 flex-col gap-3.5">
        <SectionTitle>File evidence</SectionTitle>

        <Callout tone="muted">
          The window has closed, so this dispute no longer accepts evidence. The match is about to
          be cancelled automatically.
        </Callout>
      </section>
    );
  }

  const messageError = errors.message?.message;
  const serverError = submit.isError ? submitEvidenceErrorMessage(submit.error) : null;

  return (
    <section className="flex min-w-0 flex-col gap-3.5">
      <SectionTitle>File evidence</SectionTitle>

      <p className="max-w-prose text-sm text-text-secondary">
        You are the one who speaks for <strong className="text-text-primary">{myName}</strong>.
        Attach what proves your version — a scoreboard screenshot, a match link exported as a PDF —
        and say what it shows. Both camps see everything filed here; an admin reads it and decides.
      </p>

      <form onSubmit={onSubmit} noValidate className="flex min-w-0 flex-col gap-5">
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={messageId}>What this shows</Label>
          <textarea
            id={messageId}
            rows={3}
            aria-invalid={Boolean(messageError)}
            // Without this, a screen reader announces "invalid" and stops there: the reason
            // sits in an element nothing points at.
            aria-describedby={messageError ? `${messageHintId} ${messageErrorId}` : messageHintId}
            disabled={submit.isPending}
            className="focus-ring min-w-0 rounded-control border border-border-control bg-surface-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-50"
            {...register('message')}
          />
          <p id={messageHintId} className="text-xs text-text-muted">
            Required. Keep it factual — this is what an admin has to go on.
          </p>
          {messageError ? (
            <FormMessage id={messageErrorId}>{messageError}</FormMessage>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-2">

          <p id={attachmentHintId} className="text-xs label-caps text-text-muted">
            Attachment
          </p>
          <EvidencePicker
            value={attachment}
            onChange={(picked) => {
              setAttachment(picked);
              if (picked) setAttachmentError(null);
            }}
            progress={uploadProgress}
            disabled={submit.isPending}
            // Both land on the picker's VISIBLE button, never on its hidden `<input
            // type="file">` — that one is `display: none`, so anything carried there is
            // announced to nobody.
            describedBy={attachmentError ? `${attachmentHintId} ${attachmentErrorId}` : attachmentHintId}
            invalid={Boolean(attachmentError)}
          />
          {attachmentError ? (
            <FormMessage id={attachmentErrorId}>{attachmentError}</FormMessage>
          ) : null}
        </div>

        {serverError ? <FormMessage>{serverError}</FormMessage> : null}

        <Button type="submit" disabled={submit.isPending} className="w-fit">
          {submit.isPending ? 'Filing…' : 'File this evidence'}
        </Button>
      </form>
    </section>
  );
}
