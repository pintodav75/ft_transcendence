import { ExternalLink, FileText } from 'lucide-react';
import { useState } from 'react';

import { Avatar } from '@/components/ui/avatar';
import { Callout } from '@/components/ui/callout';
import { SectionTitle } from '@/components/ui/section-title';
import { attachmentOf, sideById } from '@/lib/dispute-detail';
import { formatMatchDate, sideName } from '@/lib/match-detail';

import type { DisputeEvidence, DisputeSide } from '@/lib/dispute-detail';

type EvidenceAttachmentProps = {
  evidenceUrl: string;
  /** Names the post the attachment belongs to, so the link is unambiguous in a list of them. */
  postedBy: string;
};

/**
 * The file itself: a thumbnail when it is an image, always an explicit link.
 *
 * 🚨 THE `<img>` IS GRANTED ONLY ON A KNOWN IMAGE EXTENSION (`attachmentOf`), never "just in
 * case" — see that function for what a PDF in an `<img>` really costs (a broken glyph and a
 * pointless download of the whole file, NOT the console line one might assume).
 *
 * ⚠️ THE URL IS PRESIGNED AND LIVES ~5 MINUTES (private bucket), and an EXPIRED one answers 403 —
 * that one IS a red console line. What keeps this safe is NOT the `onError` below (Chrome logs a
 * failed request whatever the handler does) but `useDispute`'s `gcTime: 0`: no render can ever
 * carry a cached, expired url. The `onError` is belt-and-braces for the genuinely unlucky case —
 * the signature expiring between the fetch and the paint — and it degrades to the link rather
 * than leaving a broken-image glyph.
 *
 * ⚠️ THAT FALLBACK IS ALSO WHY THE AUDIT CANNOT JUST COUNT `<img>` NODES HERE: it removes the
 * element before any check can read it, so the naive assertion is green even on a build that
 * renders every PDF as an image. `D15` therefore counts the REQUEST for the `.pdf` object, which
 * no handler can take back.
 *
 * ⚠️ NO `loading="lazy"`, deliberately: deferring the request is precisely how an image would end
 * up asking for a url that has since expired.
 */
function EvidenceAttachment({ evidenceUrl, postedBy }: EvidenceAttachmentProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const attachment = attachmentOf(evidenceUrl);

  // Neither http nor https (or unparsable): `javascript:` / `data:` / `file:` all survive URL
  // parsing and are XSS vectors in an `href`. Nothing is rendered rather than something clickable.
  if (!attachment) {
    return (
      <p className="text-xs text-text-muted">This attachment could not be opened.</p>
    );
  }

  const showThumbnail = attachment.kind === 'image' && !imageFailed;

  return (
    <a
      href={attachment.href}
      // A presigned attachment opens in its own tab: a PDF would otherwise navigate away from the
      // dispute file, and `noopener noreferrer` is mandatory with `_blank`.
      target="_blank"
      rel="noopener noreferrer"
      className="focus-ring flex w-fit max-w-full min-w-0 items-center gap-3 rounded-control border border-border-subtle bg-surface-input px-3 py-2 text-xs text-text-secondary transition hover:border-border-strong hover:text-text-primary"
    >
      {showThumbnail ? (
        // `alt=""`: the link's own text is its accessible name, and describing the picture twice
        // is what makes a screen reader read "image image".
        <img
          src={attachment.href}
          alt=""
          onError={() => setImageFailed(true)}
          className="size-16 shrink-0 rounded-control border border-border-subtle object-cover"
        />
      ) : (
        <FileText aria-hidden="true" className="size-5 shrink-0" />
      )}
      <span className="min-w-0 break-words">
        Open the attachment ({attachment.label}) from {postedBy}
      </span>
      <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
    </a>
  );
}

type EvidenceThreadProps = {
  evidence: DisputeEvidence[];
  sides: DisputeSide[];
  /** `isSoloMatch(file.match)` — decided by the LADDER'S FORMAT, never by a missing team. */
  solo: boolean;
};

/**
 * The thread: every piece of evidence both camps have filed, oldest first (the API sorts it).
 *
 * 🚨 IT IS NOT A CHAT WITH THE ADMIN, and the copy must never suggest one. There is no such route:
 * a camp files evidence, both camps read the thread, an admin rules and leaves a note. Promising a
 * conversation would promise something the backend cannot deliver.
 *
 * 🔑 EACH POST CARRIES ITS CAMP, and that is what makes the thread legible: `matchSideId` resolved
 * through the sides list turns a wall of screenshots into "what Alpha says" against "what Bravo
 * says". Without it, an admin would have to guess from the pseudo.
 *
 * ⚠️ AN EMPTY THREAD IS THE NORMAL STARTING STATE, not a failure: a dispute opens with no evidence
 * at all. It gets a sentence that says so, never a spinner or a dash.
 */
export function EvidenceThread({ evidence, sides, solo }: EvidenceThreadProps) {
  return (
    <section className="flex min-w-0 flex-col gap-3.5">
      <SectionTitle>Evidence</SectionTitle>

      {evidence.length === 0 ? (
        <Callout tone="muted">
          Nothing has been filed yet. Both camps can attach a screenshot or a PDF with a short
          explanation — that is what an admin reads to settle the match.
        </Callout>
      ) : (
        // Named so a screen reader hears WHICH list this is, and so a selector can target it
        // rather than any `<ul>` of the page. `role="list"` is explicit (Safari drops the role
        // from a `<ul>` whose display is not `list-item`).
        <ul role="list" aria-label="Evidence filed" className="flex flex-col gap-3">
          {evidence.map((post) => {
            const side = sideById(sides, post.matchSideId);
            // 🚨 `author` is `null` when the account has been DELETED (`submitted_by_user_id` is
            // nullable for exactly that). A blank there would silently erase someone who really
            // filed something.
            const authorName = post.author
              ? (post.author.displayName ?? post.author.pseudo)
              : 'Deleted account';
            const campName = side ? sideName(side, solo) : 'Unknown camp';

            return (
              <li
                key={post.id}
                className="flex min-w-0 flex-col gap-3 rounded-card border border-border-subtle bg-surface-card-strong/60 p-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    src={post.author?.avatarUrl}
                    alt=""
                    fallback={authorName.slice(0, 2).toUpperCase()}
                    className="size-9 shrink-0"
                  />
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                    <span className="break-words font-bold text-text-primary">{authorName}</span>
                    <span className="break-words text-text-secondary">for {campName}</span>
                    {/* `dateTime` carries the machine-readable instant next to the formatted one,
                        which is the whole reason `<time>` exists.
                        ⚠️ `text-text-secondary` (7.81:1) and NOT `text-text-muted` (4.23:1, under
                        AA — the repo's known debt): WHEN a piece of evidence was filed is data an
                        admin arbitrates on, not a hint. */}
                    <time dateTime={post.submittedAt} className="text-text-secondary">
                      {formatMatchDate(post.submittedAt, 'long')}
                    </time>
                  </p>
                </div>

                {/* `message` is `string | null` in the contract even though the route now demands
                    one: a row written before that guard would render an empty paragraph. */}
                {post.message && (
                  <p className="max-w-prose min-w-0 break-words whitespace-pre-line text-sm text-text-secondary">
                    {post.message}
                  </p>
                )}

                <EvidenceAttachment evidenceUrl={post.evidenceUrl} postedBy={authorName} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
