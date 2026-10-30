/**
 * The words and small rules of Settings, Page look (TAT-56). Plain
 * TypeScript, so a unit test loads it (tests/unit/inertia/page_look_copy.spec.ts);
 * the page and its components only lay them out. The lists themselves (themes,
 * fonts, sections, the theme's violets) come from the server, which owns
 * them (#modules/storefront/look).
 */
import { uploadingText } from "./photos.js";

export type FontKey = "eczar" | "serif" | "sans";

/**
 * The words of each section an owner can show, hide and order, in the
 * server's order (its SECTION_KEYS; page_look_copy.spec.ts compares the two).
 * A new section is a key and its words here, and the type follows.
 */
export const SECTION_WORDS = {
	work: {
		title: "Recent work",
		description:
			"The newest photos from all your artists, with a link to all of them.",
	},
	artists: {
		title: "Artists",
		description:
			"Each artist with their photo, styles and status. Their own pages work either way.",
	},
	inquiry: {
		title: "The form",
		description: "Where clients send their idea. Always on your page.",
	},
} as const satisfies Record<string, { title: string; description: string }>;
export type SectionKey = keyof typeof SECTION_WORDS;

/** The section that cannot be hidden: a client can always send an idea. */
export const REQUIRED_SECTION: SectionKey = "inquiry";

/** What the page gets of the stored look (PageLookController.show). */
export type PageLookProps = {
	theme: string;
	accent: string | null;
	accentDark: string | null;
	font: FontKey;
	/** The sections shown, in order. */
	sections: SectionKey[];
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

export const SECTIONS_INTRO =
	"What your page shows under its cover and intro, in this order.";

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

/** One line of the sections list: a section and whether the page shows it. */
export type SectionRow = { key: SectionKey; shown: boolean };

/**
 * The list's rows: the shown sections in their order, then the hidden ones
 * (`all` is the server's list of every section) in the server's order.
 */
export function sectionRows(
	shown: readonly SectionKey[],
	all: readonly SectionKey[],
): SectionRow[] {
	return [
		...shown.map((key) => ({ key, shown: true })),
		...all
			.filter((key) => !shown.includes(key))
			.map((key) => ({ key, shown: false })),
	];
}

export type MoveDirection = "up" | "down";

/** Whether a row's move button has somewhere to go: the first row cannot move earlier, the last later. */
export function canMove(
	index: number,
	count: number,
	direction: MoveDirection,
): boolean {
	return direction === "up" ? index > 0 : index < count - 1;
}

/** The rows with one moved a place earlier or later; the same rows when it cannot move. */
export function moveRow(
	rows: SectionRow[],
	index: number,
	direction: MoveDirection,
): SectionRow[] {
	if (!canMove(index, rows.length, direction) || !rows[index]) return rows;
	const target = direction === "up" ? index - 1 : index + 1;
	const moved = [...rows];
	[moved[index], moved[target]] = [moved[target], moved[index]];
	return moved;
}

/** The rows with one shown or hidden; the form cannot be hidden. */
export function toggleRow(
	rows: SectionRow[],
	index: number,
	shown: boolean,
): SectionRow[] {
	const row = rows[index];
	if (!row || (row.key === REQUIRED_SECTION && !shown)) return rows;
	return rows.map((other, at) => (at === index ? { ...other, shown } : other));
}

/** The keys the form sends: the shown rows, in order. */
export function sentSections(rows: readonly SectionRow[]): SectionKey[] {
	return rows.filter((row) => row.shown).map((row) => row.key);
}

/** The message under the sections list: the list's own, else the first one on an item (`sections.0`). */
export function sectionsError(
	errors: Readonly<Record<string, string>>,
): string | undefined {
	if (errors.sections) return errors.sections;
	const key = Object.keys(errors).find((name) => name.startsWith("sections."));
	return key === undefined ? undefined : errors[key];
}

/** A move button's name: "Move Recent work earlier". */
export function moveSectionLabel(
	title: string,
	direction: MoveDirection,
): string {
	return `Move ${title} ${direction === "up" ? "earlier" : "later"}`;
}

/**
 * Which of a moved row's buttons takes focus (React moves the row's node, and
 * a moved node loses focus): the one that was pressed, or the row's other one
 * when the move left the pressed one disabled, since a disabled button cannot
 * hold focus. `index` is the row's place after the move.
 */
export function focusAfterMove(
	index: number,
	count: number,
	direction: MoveDirection,
): MoveDirection {
	if (canMove(index, count, direction)) return direction;
	return direction === "up" ? "down" : "up";
}

/**
 * The class that sets a font card's sample (the studio's name) in its face:
 * the storefront's own stacks (`--display-face`, `--serif-face`, `--body-face`
 * in css/app.css; page_look_source.spec.ts pins them to the storefront's).
 */
export const FONT_SAMPLE_CLASS: Record<FontKey, string> = {
	eczar: "font-display",
	serif: "font-(family-name:--serif-face)",
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
 * What a form control shows after a render (fix rounds 1 and 4): what the owner
 * picked or typed, until the stored value changes (`stored` is no longer what
 * the control last `seen`): then the stored value. That is a save landing (the
 * stored, normalised value shows) or fresher data arriving, such as the look
 * another tab saved coming back with this page's logo removal. A refusal leaves
 * the stored value alone, so the pick and its error stay. Controls follow the
 * stored value in place instead of being remounted by a key, because a remount
 * drops the focus of a control that Enter has just submitted.
 */
export function followStored<T>(picked: T, stored: T, seen: T): T {
	return stored === seen ? picked : stored;
}

/** A colour box's text after a render: `followStored` for the text. */
export function colourText(
	typed: string,
	stored: string,
	seen: string,
): string {
	return followStored(typed, stored, seen);
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
