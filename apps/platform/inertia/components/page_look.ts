/**
 * The words and small rules of Settings, Page look (TAT-56). Plain
 * TypeScript, so a unit test loads it (tests/unit/inertia/page_look_copy.spec.ts);
 * the page and its components only lay them out. The lists themselves (themes,
 * fonts, placements, the theme's violets) come from the server, which owns
 * them (#modules/storefront/look).
 */
import { uploadingText } from "./photos.js";

/** The artists list's place on the page: the server's keys. */
export type PlacementKey = "first" | "last" | "hidden";
export type FontKey = "eczar" | "serif" | "sans";

/** What the page gets of the stored look (PageLookController.show). */
export type PageLookProps = {
	theme: string;
	accent: string | null;
	accentDark: string | null;
	font: FontKey;
	artists: PlacementKey;
};

export type ThemeOption = { key: string; label: string; description: string };
export type FontOption = { key: FontKey; label: string };

/** The logo as Settings, Page look gets it: the 640 px copy and its own size. */
export type LogoProps = { previewUrl: string; width: number; height: number };

/** The theme's violets: where an empty colour box starts its swatch. */
export type Swatches = { light: string; dark: string };

export const PREVIEW_NOTE =
	"It shows what you've saved. A change can take up to 15 minutes to appear.";

export const SAVED_NOTE =
	"Page look saved. It can take up to 15 minutes to show on your page.";

export const COLOUR_HELP =
	"Buttons, links and the frame around photos. Leave it empty to keep the stencil violet. Avoid red: your page uses red for mistakes in the form.";

export const DARK_COLOUR_HELP =
	"For phones set to dark mode. Leave it empty to use a lighter shade of your colour.";

export const PLACEMENT_INTRO =
	"The form where clients send their idea is always on your page.";

export const LOGO_INTRO =
	"Shown above your studio's name, on each artist's page and on the deposit page, on a light tile. A dark logo saved as a PNG with a see-through background works best.";

export const NO_LOGO =
	"No logo yet. Your page shows your studio's name on its own.";

export const LOGO_FILE_HELP =
	"JPEG, PNG or WebP, up to 10 MB. Only a PNG keeps a see-through background.";

export const REMOVE_LOGO_QUESTION =
	"Remove the logo? Your page will show your studio's name on its own.";

export const COVER_INTRO_LINE =
	"The big photo at the top of your page, with your studio's name over it.";

/** The words of each place for the artists list. Only "hidden" needs a second line. */
export const PLACEMENT_WORDS: Record<
	PlacementKey,
	{ title: string; description: string | null }
> = {
	first: { title: "Artists, then the form", description: null },
	last: { title: "The form, then artists", description: null },
	hidden: {
		title: "Don't show the artists list",
		description:
			"Clients can still choose an artist in the form, and each artist's own page still works.",
	},
};

/** The class that sets a font card's sample (the studio's name) in its face. */
export const FONT_SAMPLE_CLASS: Record<FontKey, string> = {
	eczar: "font-display",
	serif: "font-serif",
	sans: "font-sans",
};

/**
 * What the colour swatch shows: the typed colour in lowercase while it is a
 * whole "#rrggbb", else `fallback` (the theme's violet). The server decides
 * whether a colour is accepted; this only keeps the native picker valid,
 * since it takes nothing but "#rrggbb".
 */
export function swatchValue(text: string, fallback: string): string {
	const value = text.trim().toLowerCase();
	return /^#[0-9a-f]{6}$/.test(value) ? value : fallback;
}

/**
 * What a colour box shows after a render (fix round 1): what was typed, until
 * the stored colour changes (`stored` is no longer what the box last `seen`),
 * which is a save: then the stored, lowercased colour. A refusal leaves the
 * stored colour alone, so the typed text and its error stay. The box follows
 * the stored colour instead of being remounted by a key, because a remount
 * drops the focus of a box that Enter has just submitted.
 */
export function colourText(
	typed: string,
	stored: string,
	seen: string,
): string {
	return stored === seen ? typed : stored;
}

/**
 * Whether a Save button takes focus back (fix rounds 1 and 2): it had focus
 * when a save started, the save has just ended, and no other control holds
 * focus now (`otherHasFocus`: `document.activeElement` is something besides
 * the page itself and this button). The button is disabled while it saves
 * (docs/ui.md), and a focused button that gets disabled drops its focus to the
 * page, so without this a keyboard or screen reader user lands on <body> after
 * every save. The blur happens during React's commit, where `onBlur` does not
 * run, so `hadFocus` can be stale: if the user moved to another field while
 * the request was pending, that field keeps its focus.
 */
export function takesFocusBack(
	hadFocus: boolean,
	wasProcessing: boolean,
	processing: boolean,
	otherHasFocus: boolean,
): boolean {
	return hadFocus && wasProcessing && !processing && !otherHasFocus;
}

/** The logo form's button: upload, replace, or the wait. */
export function logoButton(
	hasLogo: boolean,
	processing: boolean,
	percentage?: number,
): string {
	if (processing) return uploadingText(percentage);
	return hasLogo ? "Replace logo" : "Upload logo";
}

/** The cover section's one line. */
export function coverLine(hasCover: boolean): string {
	return hasCover ? "You have a cover photo." : "No cover photo yet.";
}

/** The cover section's link, to the form in Studio profile. */
export function coverLink(hasCover: boolean): string {
	return hasCover ? "Change it in Studio profile" : "Add one in Studio profile";
}
