/**
 * Size of every section title on /profile, in one place so they can't drift.
 *
 * local to this page: ui/section-title.tsx has ~50 call sites and renders on every
 * authenticated page, so changing its default redraws the whole app. folded through
 * headingClassName instead.
 * text-base = the size of the page's values (bio, email, 2FA state), without competing with the h1.
 * .ts and not .tsx so Fast Refresh isn't broken, same as button-variants.ts.
 */
export const SECTION_TITLE_SIZE = 'text-base';
