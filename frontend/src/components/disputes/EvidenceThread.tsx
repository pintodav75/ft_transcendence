import { ExternalLink, FileText } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { Avatar } from '@/components/ui/avatar';
import { Callout } from '@/components/ui/callout';
import { SectionTitle } from '@/components/ui/section-title';
import { attachmentOf, sideById } from '@/lib/dispute-detail';
import { formatMatchDate, sideName } from '@/lib/match-detail';
import { useBackFrom } from '@/lib/back-navigation';

import type { DisputeEvidence, DisputeSide } from '@/lib/dispute-detail';

type EvidenceAttachmentProps = {
  evidenceUrl: string;
  /** Names the post the attachment belongs to, so the link is unambiguous in a list of them. */
  postedBy: string;
};

/** The file itself: a thumbnail when it is an image, always an explicit link. */
function EvidenceAttachment({ evidenceUrl, postedBy }: EvidenceAttachmentProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const attachment = attachmentOf(evidenceUrl);

  // Neither http nor https (or unparsable): `javascript:` / `data:` / `file:` all survive URL
  // parsing and are XSS vectors in an `href`.
  if (!attachment) {
    return (
      <p className="text-xs text-text-muted">This attachment could not be opened.</p>
    );
  }

  const showThumbnail = attachment.kind === 'image' && !imageFailed;

  return (
    <a
      href={attachment.href}
      // A presigned attachment opens in its own tab: a PDF would otherwise navigate away from
      // the dispute file, and `noopener noreferrer` is mandatory with `_blank`.
      target="_blank"
      rel="noopener noreferrer"
      className="focus-ring flex w-fit max-w-full min-w-0 items-center gap-3 rounded-control border border-border-subtle bg-surface-input px-3 py-2 text-xs text-text-secondary transition hover:border-border-strong hover:text-text-primary"
    >
      {showThumbnail ? (
        // `alt=""`: the link's own text is its accessible name, and describing the picture
        // twice is what makes a screen reader read "image image".
        <img
          src={attachment.href}
          alt=""
          onError={() => setImageFailed(true)}
          className="size-16 shrink-0 rounded-control border border-border-subtle object-cover"
        />
      ) : (
        <FileText aria-hidden="true" className="size-5 shrink-0" />
      )}
      <span className="min-w-0 wrap-break-word">
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

/** The thread: every piece of evidence both camps have filed, oldest first (the API sorts it). */
export function EvidenceThread({ evidence, sides, solo }: EvidenceThreadProps) {
  // Read once at component level, never inside the map: it is a hook.
  const { backFrom } = useBackFrom();

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
        // rather than any `<ul>` of the page.
        <ul role="list" aria-label="Evidence filed" className="flex flex-col gap-3">
          {evidence.map((post) => {
            const side = sideById(sides, post.matchSideId);
            // `author` is `null` when the account has been DELETED (`submitted_by_user_id` is
            // nullable for exactly that).
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

                    {post.author ? (
                      <Link
                        to="/players/$pseudo"
                        params={{ pseudo: post.author.pseudo }}
                        // Nomme ce vers quoi la page du joueur revient (ce dossier de litige).
                        state={{ backFrom }}
                        className="focus-ring wrap-break-word rounded-control font-bold text-text-primary underline-offset-4 hover:underline"
                      >
                        {authorName}
                      </Link>
                    ) : (
                      <span className="wrap-break-word font-bold text-text-primary">{authorName}</span>
                    )}

                    <span className="wrap-break-word text-text-secondary">
                      for{' '}
                      {side?.team ? (
                        <Link
                          to="/teams/$teamId"
                          params={{ teamId: side.team.id }}
                          className="focus-ring rounded-control underline-offset-4 hover:underline"
                        >
                          {campName}
                        </Link>
                      ) : solo && side?.players[0] ? (
                        <Link
                          to="/players/$pseudo"
                          params={{ pseudo: side.players[0].pseudo }}
                          state={{ backFrom }}
                          className="focus-ring rounded-control underline-offset-4 hover:underline"
                        >
                          {campName}
                        </Link>
                      ) : (
                        campName
                      )}
                    </span>

                    <time dateTime={post.submittedAt} className="text-text-secondary">
                      {formatMatchDate(post.submittedAt, 'long')}
                    </time>
                  </p>
                </div>

                {post.message && (
                  <p className="max-w-prose min-w-0 wrap-break-word whitespace-pre-line text-sm text-text-secondary">
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
