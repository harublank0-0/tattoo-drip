import { test } from "@japa/runner";
import {
	FONT_KEYS,
	FONTS,
	SECTION_KEYS,
	THEME_ACCENT,
	THEMES,
} from "#modules/storefront/look";
import { LOOK_SAVED_MESSAGE } from "#modules/tenancy/look_messages";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `PageLookModule` below restates its shape and the inertia project type-checks the real one.
import * as pageLookModule from "../../../inertia/components/page_look.js";

type PageLookModule = {
	swatchValue(text: string, fallback: string): string;
	colourText(typed: string, stored: string, seen: string): string;
	followStored<T>(picked: T, stored: T, seen: T): T;
	takesFocusBack(
		hadFocus: boolean,
		wasProcessing: boolean,
		processing: boolean,
		otherHasFocus: boolean,
	): boolean;
	logoButton(
		hasLogo: boolean,
		processing: boolean,
		percentage?: number,
	): string;
	coverLine(hasCover: boolean): string;
	coverLink(hasCover: boolean): string;
	SECTION_WORDS: Record<string, { title: string; description: string }>;
	REQUIRED_SECTION: string;
	sectionRows(
		shown: readonly string[],
		all: readonly string[],
	): { key: string; shown: boolean }[];
	moveRow(
		rows: { key: string; shown: boolean }[],
		index: number,
		direction: "up" | "down",
	): { key: string; shown: boolean }[];
	toggleRow(
		rows: { key: string; shown: boolean }[],
		index: number,
		shown: boolean,
	): { key: string; shown: boolean }[];
	sentSections(rows: { key: string; shown: boolean }[]): string[];
	moveSectionLabel(title: string, direction: "up" | "down"): string;
	sectionsError(errors: Record<string, string>): string | undefined;
	canMove(index: number, count: number, direction: "up" | "down"): boolean;
	focusAfterMove(
		index: number,
		count: number,
		direction: "up" | "down",
	): "up" | "down";
	FONT_SAMPLE_CLASS: Record<string, string>;
	PREVIEW_NOTE: string;
	SAVED_NOTE: string;
	COLOUR_HELP: string;
	DARK_COLOUR_HELP: string;
	LOGO_INTRO: string;
	NO_LOGO: string;
	LOGO_FILE_HELP: string;
	REMOVE_LOGO_QUESTION: string;
	COVER_INTRO_LINE: string;
	SECTIONS_INTRO: string;
};
const words = pageLookModule as PageLookModule;

test.group("page look words (TAT-56)", () => {
	test("the swatch shows the typed colour in lowercase, else its fallback", ({
		assert,
	}) => {
		const fallback = THEME_ACCENT;
		assert.equal(words.swatchValue("#0F766E", fallback), "#0f766e");
		assert.equal(words.swatchValue("#0f766e", fallback), "#0f766e");
		assert.equal(words.swatchValue(" #0f766e ", fallback), "#0f766e");
		assert.equal(words.swatchValue("", fallback), fallback);
		assert.equal(words.swatchValue("#0f76", fallback), fallback);
		assert.equal(words.swatchValue("teal", fallback), fallback);
		assert.equal(words.swatchValue("#0f766eff", fallback), fallback);
		assert.equal(words.swatchValue("#gggggg", fallback), fallback);
	});

	// Fix round 1: a save must not drop the typed text of a refused colour, nor leave a stale
	// one after a good save, and the Save button disabled while it works loses focus.
	test("a colour box keeps what was typed until the stored colour changes", ({
		assert,
	}) => {
		// Nothing stored changed (a refusal, or typing): the typed text stays.
		assert.equal(words.colourText("#E8A317", "", ""), "#E8A317");
		assert.equal(words.colourText("#0F766E", "#0f766e", "#0f766e"), "#0F766E");
		// The stored colour changed (a save): the box shows the stored, lowercased value.
		assert.equal(words.colourText("#0F766E", "#0f766e", ""), "#0f766e");
		assert.equal(words.colourText("#0f766e", "", "#0f766e"), "");
	});

	// Fix round 4: the radio groups follow a changed stored choice in place, like the colour boxes.
	test("a choice follows the stored value when it changes and keeps the pick when it does not", ({
		assert,
	}) => {
		// Stored changed (another tab saved, or this save landed): the group shows the stored value.
		assert.equal(words.followStored("eczar", "serif", "eczar"), "serif");
		assert.equal(words.followStored("sans", "serif", "eczar"), "serif");
		// Stored unchanged: the owner's pick stays, typed or chosen but not yet saved.
		assert.equal(words.followStored("sans", "eczar", "eczar"), "sans");
		// A refused save leaves the stored value alone, so the pick stays.
		assert.equal(words.followStored("comic", "eczar", "eczar"), "comic");
		// It is the one rule: the colour boxes are this with strings.
		assert.equal(
			words.colourText("#E8A317", "", ""),
			words.followStored("#E8A317", "", ""),
		);
	});

	test("the Save button takes focus back only when it had it, a save has just ended and no other control holds focus", async ({
		assert,
	}) => {
		assert.isTrue(words.takesFocusBack(true, true, false, false));
		assert.isFalse(
			words.takesFocusBack(false, true, false, false),
			"focus moved on",
		);
		assert.isFalse(
			words.takesFocusBack(true, false, false, false),
			"no save was running",
		);
		assert.isFalse(
			words.takesFocusBack(true, true, true, false),
			"still saving",
		);
		assert.isFalse(
			words.takesFocusBack(true, false, true, false),
			"a save is starting",
		);
		// Fix round 2: the user moved to another field while the save was pending (the blur
		// happens in React's commit, where onBlur does not run, so `hadFocus` is stale).
		assert.isFalse(
			words.takesFocusBack(true, true, false, true),
			"another control has focus",
		);
	});

	test("the logo button says upload, replace or the wait", ({ assert }) => {
		assert.equal(words.logoButton(false, false), "Upload logo");
		assert.equal(words.logoButton(true, false), "Replace logo");
		assert.equal(words.logoButton(true, true, 40), "Uploading… 40%");
		assert.equal(words.logoButton(false, true), "Uploading…");
	});

	test("the cover line and link depend on whether there is a cover", ({
		assert,
	}) => {
		assert.equal(words.coverLine(true), "You have a cover photo.");
		assert.equal(words.coverLine(false), "No cover photo yet.");
		assert.equal(words.coverLink(true), "Change it in Studio profile");
		assert.equal(words.coverLink(false), "Add one in Studio profile");
	});

	test("there are words for exactly the server's sections, in its order", ({
		assert,
	}) => {
		assert.deepEqual(Object.keys(words.SECTION_WORDS), [...SECTION_KEYS]);
		assert.deepEqual(
			SECTION_KEYS.map((key) => words.SECTION_WORDS[key].title),
			["Recent work", "Artists", "Good to know", "The form"],
		);
		assert.deepEqual(
			SECTION_KEYS.map((key) => words.SECTION_WORDS[key].description),
			[
				"The newest photos from all your artists, with a link to all of them.",
				"Each artist with their photo, styles and status. Their own pages work either way.",
				"Your hours, closed days, walk-ins, age rule, deposit policy, and what to do before and after a session. Shows only what you filled in.",
				"Where clients send their idea. Always on your page.",
			],
		);
		assert.equal(words.REQUIRED_SECTION, "inquiry");
		assert.include([...SECTION_KEYS], words.REQUIRED_SECTION);
	});

	const ALL = ["work", "artists", "inquiry"];

	test("the rows are the shown sections in their order, then the hidden ones", ({
		assert,
	}) => {
		assert.deepEqual(words.sectionRows(["artists", "inquiry"], ALL), [
			{ key: "artists", shown: true },
			{ key: "inquiry", shown: true },
			{ key: "work", shown: false },
		]);
		assert.deepEqual(words.sectionRows(ALL, ALL), [
			{ key: "work", shown: true },
			{ key: "artists", shown: true },
			{ key: "inquiry", shown: true },
		]);
		assert.deepEqual(words.sectionRows(["inquiry"], ALL), [
			{ key: "inquiry", shown: true },
			{ key: "work", shown: false },
			{ key: "artists", shown: false },
		]);
	});

	test("a row moves one place earlier or later, and not past either end", ({
		assert,
	}) => {
		const rows = words.sectionRows(["artists", "inquiry"], ALL);
		assert.deepEqual(
			words.moveRow(rows, 2, "up").map((row) => row.key),
			["artists", "work", "inquiry"],
		);
		assert.deepEqual(
			words.moveRow(rows, 0, "down").map((row) => row.key),
			["inquiry", "artists", "work"],
		);
		assert.deepEqual(words.moveRow(rows, 0, "up"), rows);
		assert.deepEqual(words.moveRow(rows, 2, "down"), rows);
		assert.deepEqual(words.moveRow(rows, 7, "up"), rows);
		// A move keeps whether each row is shown, and leaves the list it was given alone.
		const moved = words.moveRow(rows, 2, "up");
		assert.isFalse(moved[1].shown);
		assert.deepEqual(rows, words.sectionRows(["artists", "inquiry"], ALL));
	});

	test("a row can be shown or hidden, but the form is always shown", ({
		assert,
	}) => {
		const rows = words.sectionRows(["artists", "inquiry"], ALL);
		assert.deepEqual(words.toggleRow(rows, 2, true)[2], {
			key: "work",
			shown: true,
		});
		assert.deepEqual(words.toggleRow(rows, 0, false)[0], {
			key: "artists",
			shown: false,
		});
		// The form (index 1) cannot be hidden, whatever is asked.
		assert.deepEqual(words.toggleRow(rows, 1, false), rows);
		assert.isTrue(words.toggleRow(rows, 1, true)[1].shown);
		assert.deepEqual(words.toggleRow(rows, 9, true), rows);
		assert.deepEqual(rows, words.sectionRows(["artists", "inquiry"], ALL));
	});

	test("the form sends the shown sections, in order", ({ assert }) => {
		assert.deepEqual(
			words.sentSections([
				{ key: "work", shown: true },
				{ key: "artists", shown: false },
				{ key: "inquiry", shown: true },
			]),
			["work", "inquiry"],
		);
		assert.deepEqual(
			words.sentSections(words.sectionRows(["artists", "inquiry"], ALL)),
			["artists", "inquiry"],
		);
	});

	test("a move button is named for the section and the direction", ({
		assert,
	}) => {
		assert.equal(
			words.moveSectionLabel("Recent work", "up"),
			"Move Recent work earlier",
		);
		assert.equal(
			words.moveSectionLabel("Recent work", "down"),
			"Move Recent work later",
		);
	});

	test("the message under the list is the list's own, else the first on an item", ({
		assert,
	}) => {
		assert.equal(words.sectionsError({}), undefined);
		assert.equal(words.sectionsError({ theme: "x" }), undefined);
		assert.equal(
			words.sectionsError({ "sections.0": "Choose sections from the list." }),
			"Choose sections from the list.",
		);
		assert.equal(
			words.sectionsError({
				"sections.1": "second",
				sections: "Show each section once.",
				"sections.0": "first",
			}),
			"Show each section once.",
		);
		assert.equal(
			words.sectionsError({ "sections.2": "later", "sections.1": "sooner" }),
			"later",
		);
		// Another field that merely starts with the word is not the list's.
		assert.equal(words.sectionsError({ sectionsOther: "x" }), undefined);
	});

	test("a move button is disabled where the row has nowhere to go", ({
		assert,
	}) => {
		assert.isFalse(words.canMove(0, 3, "up"));
		assert.isTrue(words.canMove(0, 3, "down"));
		assert.isTrue(words.canMove(1, 3, "up"));
		assert.isTrue(words.canMove(1, 3, "down"));
		assert.isTrue(words.canMove(2, 3, "up"));
		assert.isFalse(words.canMove(2, 3, "down"));
	});

	test("after a move, focus stays on the pressed button, or goes to the row's other one when that is now disabled", ({
		assert,
	}) => {
		// Moved earlier into the middle: Move earlier is still enabled.
		assert.equal(words.focusAfterMove(1, 3, "up"), "up");
		// Moved earlier to the top: Move earlier is disabled, so Move later takes focus.
		assert.equal(words.focusAfterMove(0, 3, "up"), "down");
		// Moved later to the bottom: Move later is disabled, so Move earlier takes focus.
		assert.equal(words.focusAfterMove(2, 3, "down"), "up");
		assert.equal(words.focusAfterMove(1, 3, "down"), "down");
	});

	test("every font has a sample face, and the server's list names each once", ({
		assert,
	}) => {
		assert.deepEqual(
			Object.keys(words.FONT_SAMPLE_CLASS).sort(),
			[...FONT_KEYS].sort(),
		);
		assert.deepEqual(
			FONTS.map((font) => font.key),
			[...FONT_KEYS],
		);
		assert.equal(words.FONT_SAMPLE_CLASS.eczar, "font-display");
		assert.equal(
			words.FONT_SAMPLE_CLASS.serif,
			"font-(family-name:--serif-face)",
		);
		assert.equal(words.FONT_SAMPLE_CLASS.sans, "font-sans");
	});

	test("the saved note and the preview note both say 15 minutes", ({
		assert,
	}) => {
		assert.equal(
			words.SAVED_NOTE,
			"Page look saved. It can take up to 15 minutes to show on your page.",
		);
		assert.equal(
			words.PREVIEW_NOTE,
			"It shows what you've saved. A change can take up to 15 minutes to appear.",
		);
		// The server's flash after a save is the same sentence.
		assert.equal(words.SAVED_NOTE, LOOK_SAVED_MESSAGE);
	});

	test("the fixed sentences", ({ assert }) => {
		assert.equal(
			words.COLOUR_HELP,
			"Buttons, links and the frame around photos. Leave it empty to keep the stencil violet. Avoid red: your page uses red for mistakes in the form.",
		);
		assert.equal(
			words.DARK_COLOUR_HELP,
			"For phones set to dark mode. Leave it empty to use a lighter shade of your colour.",
		);
		assert.equal(
			words.SECTIONS_INTRO,
			"What your page shows under its cover and intro, in this order.",
		);
		assert.equal(
			words.LOGO_INTRO,
			"Shown above your studio's name, on each artist's page and on the deposit page, on a light tile. A dark logo saved as a PNG with a see-through background works best.",
		);
		assert.equal(
			words.NO_LOGO,
			"No logo yet. Your page shows your studio's name on its own.",
		);
		assert.equal(
			words.LOGO_FILE_HELP,
			"JPEG, PNG or WebP, up to 10 MB. Only a PNG keeps a see-through background.",
		);
		assert.equal(
			words.REMOVE_LOGO_QUESTION,
			"Remove the logo? Your page will show your studio's name on its own.",
		);
		assert.equal(
			words.COVER_INTRO_LINE,
			"The big photo at the top of your page, with your studio's name over it.",
		);
	});

	test("the theme and font lists the server sends have these exact words", ({
		assert,
	}) => {
		assert.deepEqual(THEMES, [
			{
				key: "stencil-and-ink",
				label: "Stencil & Ink",
				description:
					"Paper, black ink and a violet stencil line. Made for phones.",
			},
		]);
		assert.deepEqual(FONTS, [
			{ key: "eczar", label: "Eczar (the stencil look)" },
			{ key: "serif", label: "Classic serif" },
			{ key: "sans", label: "Plain" },
		]);
	});
});
