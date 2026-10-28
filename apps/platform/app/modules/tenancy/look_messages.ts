/**
 * The words Settings, Page look says after a save (TAT-56). They live here, not
 * in #modules/storefront/look, which the public read path imports: that module
 * holds the rules and the lists the studio page applies, none of the
 * dashboard's sentences. A CDN may keep the studio page for up to about 12
 * minutes (the API's `max-age=60, stale-while-revalidate=600` and the page's
 * `s-maxage=60, stale-while-revalidate=600`), so the flash says "up to 15".
 * tests/unit/inertia/page_look_copy.spec.ts ties this to the dashboard's copy.
 */
export const LOOK_SAVED_MESSAGE =
	"Page look saved. It can take up to 15 minutes to show on your page.";
