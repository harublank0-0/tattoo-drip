/**
 * The words Settings, Page look says after a save (TAT-56). They live here, not
 * in #modules/storefront/look, which the public read path imports: that module
 * holds the rules and the lists the studio page applies, none of the
 * dashboard's sentences. A CDN may keep the studio page for up to about 12
 * minutes (the API's `max-age=60, stale-while-revalidate=600` and the page's
 * `s-maxage=60, stale-while-revalidate=600`), so the flash says "up to 15".
 * tests/unit/inertia/page_look_copy.spec.ts ties this to the dashboard's copy.
 * The logo's three (TAT-123) live here too: the plain save, the save that put a
 * light logo on the dark tile (it says so, and where to change it), and the
 * tile switch, which takes as long to show as the look.
 */
export const LOOK_SAVED_MESSAGE =
	"Page look saved. It can take up to 15 minutes to show on your page.";

export const LOGO_SAVED = "Logo saved.";

export const LOGO_SAVED_ON_DARK_TILE =
	"Logo saved. It's light, so your page shows it on a dark tile. You can change that under Logo.";

export const LOGO_TILE_SAVED =
	"Tile saved. It can take up to 15 minutes to show on your page.";
