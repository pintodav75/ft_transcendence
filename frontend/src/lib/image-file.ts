/**
 * What the server accepts for an image upload (team logo, user avatar): jpeg/png/webp, 2 MB.
 * Mirrors the backend's `IMAGE_MIME`.
 *
 * lives here and not in ui/image-picker.tsx so a screen drawing its own picker (the /profile
 * avatar) validates against the same rule, not a copy of it.
 * keep separate from EVIDENCE_MIME_TYPES in lib/dispute-detail.ts — evidence can be a PDF, cap is 5 MB.
 * the 2 refusal sentences below are shared copy, don't reword them.
 * server still checks; this is just so a bad pick fails instantly.
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
