/**
 * The client echo of what the server accepts for an IMAGE upload — a team logo
 * (`POST /teams/{id}/logo`) or a user avatar (`POST /users/me/avatar`): jpeg, png or webp,
 * 2 MB at most. It mirrors the backend's `IMAGE_MIME`.
 *
 * ⚠️ SEPARATE from `EVIDENCE_MIME_TYPES` in `lib/dispute-detail.ts`, exactly as `IMAGE_MIME`
 * is separate from `EVIDENCE_MIME` on the server (invariant #7): an avatar is an image, a
 * piece of evidence may perfectly well be a PDF, and the cap differs (2 MB against 5).
 * Merging the two would make one of the two screens lie.
 *
 * 🔑 IT LIVES HERE, AND NOT INSIDE `ui/image-picker.tsx`, so that a screen building its own
 * picker validates against the SAME rule instead of a copy of it. The profile avatar is such
 * a screen: it shows a 160 px round preview and its own Change/Remove/Confirm/Cancel
 * buttons, which is a look ImagePicker does not have — but "jpeg, png, webp, 2 MB" is not a
 * look, and a second copy of it is what drifts the day the server raises the cap.
 * Same split as [F-DISPUTE]: share the rule and the progress bar, not the markup.
 *
 * ⚠️ THE TWO SENTENCES BELOW ARE ASSERTED VERBATIM by the console-audit scenarios
 * `ft1c-team-logo.mjs` and `teams-manage.mjs`. Rewording either one turns those campaigns
 * red — the wording is part of the contract here, not a detail.
 *
 * ⚠️ The server stays the real rampart. This exists so a bad pick fails instantly and
 * readably instead of after a round trip that ends in 400/413.
 */
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const IMAGE_ACCEPT_ATTRIBUTE = IMAGE_MIME_TYPES.join(',');
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_MAX_MB = IMAGE_MAX_BYTES / (1024 * 1024);

/** Why this pick is refused, in a sentence — `null` when the file is acceptable. */
export function imageFileError(file: File): string | null {
  if (!IMAGE_MIME_TYPES.includes(file.type)) {
    return 'Use a JPEG, PNG or WebP image.';
  }

  if (file.size > IMAGE_MAX_BYTES) {
    return `Image is too large — max ${IMAGE_MAX_MB} MB.`;
  }

  return null;
}
