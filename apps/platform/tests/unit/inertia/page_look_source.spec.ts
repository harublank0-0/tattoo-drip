import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";

const read = (file: string) =>
	readFile(new URL(`../../../inertia/${file}`, import.meta.url), "utf8");

/** The source without its comments, so a hex code in a comment is not a finding. */
const withoutComments = (source: string) =>
	source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// TAT-56: Playwright is not in CI, so what a browser would show is pinned
// where it can be: the source of the page look components. Heights, focus and
// the tile itself are checked in a browser at 375 x 812 and 1280 x 800.
test.group("The page look components (TAT-56)", () => {
	test("the raw colour picker is 44 px tall below lg, like every control", async ({
		assert,
	}) => {
		const source = await read("components/colour_field.tsx");
		const picker = /<input\s[^>]*type="color"[\s\S]*?\/>/.exec(source)?.[0];
		assert.isDefined(picker, "colour_field.tsx draws a native colour input");
		assert.include(picker, "max-lg:min-h-11");
		assert.notInclude(picker, "name=", "only the text box is sent");
	});

	test("the page, the logo form and the colour field hold no colour of their own", async ({
		assert,
	}) => {
		for (const file of [
			"pages/settings/look.tsx",
			"components/logo_form.tsx",
			"components/colour_field.tsx",
		]) {
			const source = withoutComments(await read(file));
			assert.notMatch(source, /#[0-9a-fA-F]{3,8}\b/, file);
			assert.notMatch(source, /\b(?:rgb|hsl|oklch)a?\(/, file);
		}
	});

	test("the logo is drawn on the plate token, which is light in both schemes", async ({
		assert,
	}) => {
		const form = await read("components/logo_form.tsx");
		assert.include(form, "bg-logo-plate");
		const css = await read("css/app.css");
		const dark = css.indexOf("\n[data-theme='dark'] {");
		assert.isAbove(dark, 0);
		const defs = css.match(/--logo-plate:/g) ?? [];
		assert.lengthOf(defs, 1, "defined once");
		assert.isBelow(css.indexOf("--logo-plate:"), dark, "in the light :root");
		assert.include(css, "--logo-plate: #f7f3ee;");
		assert.include(css, "--color-logo-plate: var(--logo-plate);");
	});

	test("the cover form has the anchor the page links to, clear of the top bar", async ({
		assert,
	}) => {
		const cover = await read("components/cover_photo_form.tsx");
		assert.match(cover, /id="cover-photo"/);
		assert.include(
			cover,
			"scroll-mt-[calc(var(--top-bar-height,3.5rem)+0.5rem)] lg:scroll-mt-0",
		);
		const page = await read("pages/settings/look.tsx");
		assert.include(page, "#cover-photo");
	});

	// Fix round 1: a successful save changes the stored look. Keying the whole form by it remounted
	// the form and unmounted the focused Save button, so focus fell to <body>. Only the colour
	// boxes are keyed (they are the one state the page holds); Save stays mounted.
	test("the form is not keyed by the look, so the Save button keeps focus after a save", async ({
		assert,
	}) => {
		const source = await read("pages/settings/look.tsx");
		const form =
			/<Form\s[^>]*route="tenant\.settings\.look\.update"[^>]*>/.exec(
				source,
			)?.[0];
		assert.isDefined(form, "look.tsx has the look form");
		assert.notMatch(form as string, /\bkey=/);
		assert.notInclude(source, "JSON.stringify(look)");
	});

	test("the colour boxes follow a changed stored colour without remounting, so their focus stays", async ({
		assert,
	}) => {
		const page = await read("pages/settings/look.tsx");
		// A key that follows the stored colour remounts the box on a save and drops the focus of
		// a box that Enter just submitted (and two empty colours gave two siblings one key).
		for (const field of page.match(/<ColourField[\s\S]*?\/>/g) ?? []) {
			assert.notMatch(field, /\bkey=/);
		}
		const field = await read("components/colour_field.tsx");
		assert.include(field, "colourText(");
	});

	test("the Save button is the one that gets its focus back after a save", async ({
		assert,
	}) => {
		const page = await read("pages/settings/look.tsx");
		assert.include(page, "takesFocusBack(");
		assert.match(page, /<SaveButton\s+processing=\{processing\}/);
		// Disabled while it saves, like every form (docs/ui.md); the focus comes back after.
		assert.match(page, /disabled=\{processing\}/);
	});

	test("Open your page takes its 44 px below lg from the button, not a fixed height", async ({
		assert,
	}) => {
		const source = await read("pages/settings/look.tsx");
		const link = /<a\s[^>]*href=\{studioPage\.url\}[\s\S]*?>/.exec(source)?.[0];
		assert.isDefined(link);
		assert.notMatch(link as string, /\bh-11\b/);
		const button = await read("components/ui/button.tsx");
		assert.include(button, "max-lg:min-h-11");
	});

	test("Remove logo asks first, and says what happens", async ({ assert }) => {
		const form = await read("components/logo_form.tsx");
		assert.include(form, "window.confirm(REMOVE_LOGO_QUESTION)");
		assert.include(form, "tenant.settings.logo.destroy");
	});
});
