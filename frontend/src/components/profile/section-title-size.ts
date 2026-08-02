/**
 * Size of every section title on `/profile`, defined once and lent to all of them.
 *
 * One constant, not one literal per section: written out several times, the value diverges the
 * first time someone tunes a single section.
 *
 * ⚠️ LOCAL TO THIS PAGE ON PURPOSE. `ui/section-title.tsx` has ~50 call sites across the app,
 * the social rail included, so it renders on every authenticated page: changing its default is a
 * design-system decision that redraws the whole app and needs a full audit campaign, not a
 * ticket-level tweak. The component was therefore FOLDED (`headingClassName`) rather than
 * modified. If titles are ever enlarged everywhere, change the default and delete this file.
 *
 * `text-base` and no more: it is the size of the page's VALUES (the bio, the email, the 2FA
 * state). A section title should be at least as large as what it introduces — it was smaller —
 * without competing with the `<h1>`.
 *
 * ⚠️ A `.ts` and not a `.tsx`: a module that exports no component does not break Fast Refresh,
 * same reason as `button-variants.ts` and `label-variants.ts`.
 */
export const SECTION_TITLE_SIZE = 'text-base';
