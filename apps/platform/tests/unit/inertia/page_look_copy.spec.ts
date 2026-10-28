import { test } from "@japa/runner";
import {
	ARTIST_PLACEMENT_KEYS,
	FONT_KEYS,
	FONTS,
	LOOK_SAVED_MESSAGE,
	THEME_ACCENT,
	THEMES,
} from "#modules/storefront/look";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `PageLookModule` below restates its shape and the inertia project type-checks the real one.
import * as pageLookModule from "../../../inertia/components/page_look.js";

type PageLookModule = {
	swatchValue(text: string, fallback: string): string;
	logoButton(
		hasLogo: boolean,
		processing: boolean,
		percentage?: number,
	): string;
	coverLine(hasCover: boolean): string;
	coverLink(hasCover: boolean): string;
	PLACEMENT_WORDS: Record<
		string,
		{ title: string; description: string | null }
	>;
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
	PLACEMENT_INTRO: string;
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

	test("there are words for exactly the server's placements, in its order", ({
		assert,
	}) => {
		assert.deepEqual(Object.keys(words.PLACEMENT_WORDS), ARTIST_PLACEMENT_KEYS);
		assert.deepEqual(
			ARTIST_PLACEMENT_KEYS.map((key) => words.PLACEMENT_WORDS[key].title),
			[
				"Artists, then the form",
				"The form, then artists",
				"Don't show the artists list",
			],
		);
		assert.equal(
			words.PLACEMENT_WORDS.hidden.description,
			"Clients can still choose an artist in the form, and each artist's own page still works.",
		);
		assert.isNull(words.PLACEMENT_WORDS.first.description);
		assert.isNull(words.PLACEMENT_WORDS.last.description);
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
		assert.equal(words.FONT_SAMPLE_CLASS.serif, "font-serif");
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
			words.PLACEMENT_INTRO,
			"The form where clients send their idea is always on your page.",
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

	test("the theme list the server sends has plain words for each theme", ({
		assert,
	}) => {
		for (const theme of THEMES) {
			assert.match(theme.label, /\S/);
			assert.match(theme.description, /\S/);
		}
	});
});
