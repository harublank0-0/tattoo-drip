import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";

const read = (file: string) =>
	readFile(new URL(`../../../inertia/${file}`, import.meta.url), "utf8");

const readStorefront = (file: string) =>
	readFile(new URL(`../../../../storefront/${file}`, import.meta.url), "utf8");

/** A font stack without quotes or extra spaces, so two spellings of one stack compare equal. */
const stack = (value: string) =>
	value
		.replace(/['"]/g, "")
		.split(",")
		.map((family) => family.trim())
		.join(", ");

/** The value of a CSS custom property declared in a source, up to its semicolon. */
const token = (source: string, name: string) =>
	new RegExp(`${name}:\\s*([^;]+);`).exec(source)?.[1];

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

	test("the logo is drawn on the plate tokens, the same in both schemes", async ({
		assert,
	}) => {
		const form = await read("components/logo_form.tsx");
		assert.include(form, "LOGO_TILE_CLASS[logo.tile]");
		const words = await read("components/page_look.ts");
		assert.include(words, '"bg-logo-plate"');
		assert.include(words, '"bg-logo-plate-dark"');
		const css = await read("css/app.css");
		const dark = css.indexOf("\n[data-theme='dark'] {");
		assert.isAbove(dark, 0);
		const defs = css.match(/--logo-plate:/g) ?? [];
		assert.lengthOf(defs, 1, "defined once");
		assert.isBelow(css.indexOf("--logo-plate:"), dark, "in the light :root");
		assert.include(css, "--logo-plate: #f7f3ee;");
		assert.include(css, "--color-logo-plate: var(--logo-plate);");
		// TAT-123: the dark tile is the dark paper, defined once, in the light :root.
		assert.lengthOf(css.match(/--logo-plate-dark:/g) ?? [], 1, "defined once");
		assert.isBelow(
			css.indexOf("--logo-plate-dark:"),
			dark,
			"in the light :root, so it is the same in dark mode",
		);
		assert.include(css, "--logo-plate-dark: #14110f;");
		assert.include(css, "--color-logo-plate-dark: var(--logo-plate-dark);");
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

	// Fix round 4: uncontrolled radio groups ignored a stored value that changed under them (a
	// logo removed in one tab returns the look another tab saved), and a later colour-only save
	// then sent the old font and order. Each group follows the stored value in place, with no key.
	test("each radio group follows its stored value in place, and nothing is keyed", async ({
		assert,
	}) => {
		const page = await read("pages/settings/look.tsx");
		for (const [name, stored] of [
			["theme", "look.theme"],
			["font", "look.font"],
		]) {
			const group = new RegExp(`<RadioGroup\\s[^>]*name="${name}"[^>]*>`).exec(
				page,
			)?.[0];
			assert.isDefined(group, `${name} is a RadioGroup`);
			assert.match(group as string, /\bvalue=\{/, `${name} is controlled`);
			assert.match(group as string, /\bonValueChange=\{/, name);
			assert.notMatch(
				group as string,
				/defaultValue/,
				`${name} has no stale default`,
			);
			assert.include(page, `useStoredChoice(${stored})`);
		}
		assert.notMatch(
			page,
			/\bkey=\{`?(look|JSON)/,
			"nothing is keyed to the stored look",
		);
		const hook = await read("components/stored_choice.ts");
		assert.include(hook, "followStored(");
	});

	test("the Save button is the one that gets its focus back after a save", async ({
		assert,
	}) => {
		const page = await read("pages/settings/look.tsx");
		assert.include(page, "takesFocusBack(");
		// Only when no other control holds focus (the user may have moved on while it saved).
		assert.include(page, "document.activeElement");
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

	// Fix round 2: a font card shows the studio's name in the face the studio page will use.
	test("the font samples use the storefront's own font stacks", async ({
		assert,
	}) => {
		const css = await read("css/app.css");
		const storefrontCss = await readStorefront("src/styles.css");
		const branding = await readStorefront("src/studio/theme/branding.ts");
		const serif = /serif:\s*"([^"]+)"/.exec(branding)?.[1];
		assert.isDefined(serif, "the storefront's serif stack");
		assert.equal(
			stack(token(css, "--serif-face") ?? ""),
			stack(serif as string),
			"--serif-face is the storefront's serif stack",
		);
		// Eczar and the plain face are the dashboard's own tokens: the same text as the storefront's.
		for (const name of ["--display-face", "--body-face"]) {
			assert.equal(
				stack(token(css, name) ?? ""),
				stack(token(storefrontCss, name) ?? "?"),
				name,
			);
		}
		// Tailwind's own `font-serif` stack is not the storefront's, and the sign-in and error pages use it.
		assert.notMatch(withoutComments(css), /--font-serif\s*:/);
		const page = await read("components/page_look.ts");
		assert.include(page, "font-(family-name:--serif-face)");
		assert.notInclude(page, '"font-serif"');
	});

	// Fix round 2: an error under a radio group is tied to the group (role=radiogroup, which
	// takes aria-describedby and aria-invalid), as the colour boxes tie theirs to the input.
	test("each radio group's error is tied to the group", async ({ assert }) => {
		const page = await read("pages/settings/look.tsx");
		for (const name of ["theme", "font"]) {
			const group = new RegExp(`<RadioGroup\\s[^>]*name="${name}"[^>]*>`).exec(
				page,
			)?.[0];
			assert.isDefined(group, `${name} is a RadioGroup`);
			assert.match(group as string, /aria-describedby=/, name);
			assert.include(
				group as string,
				`${name}-error`,
				`${name} points at its error`,
			);
			assert.match(
				group as string,
				new RegExp(`aria-invalid=\\{!!errors\\.${name}\\}`),
				name,
			);
			assert.match(
				page,
				new RegExp(
					`<FieldError\\s+id="${name}-error">\\s*\\{errors\\.${name}\\}\\s*</FieldError>`,
				),
				`${name}'s error has the id the group points at`,
			);
		}
		// The group with a sentence under its legend points at it too.
		assert.include(page, 'id="font-help"');
		assert.include(page, "font-help");
	});

	// TAT-126: the sections list is rows, not a radio group. It follows its stored list in place
	// like the groups (no key), sends one hidden `sections[]` per shown row in the rows' order,
	// names each move button for its section and puts focus back on a button after a move.
	test("the sections list follows its stored list in place and sends the shown rows in order", async ({
		assert,
	}) => {
		const page = await read("pages/settings/look.tsx");
		assert.include(page, "useStoredRows(look.sections, sectionKeys)");
		assert.notMatch(page, /<RadioGroup\s[^>]*name="artists"/);
		assert.notInclude(page, "PLACEMENT");
		const hidden =
			/<input\s[^>]*type="hidden"[^>]*name="sections\[\]"[^>]*\/>/.exec(
				page,
			)?.[0];
		assert.isDefined(hidden, "each shown row sends a hidden sections[]");
		assert.include(page, "sentSections(rows)");
		assert.include(page, "moveSectionLabel(");
		assert.include(page, "focusAfterMove(");
		assert.include(page, "toggleRow(");
		assert.include(page, "moveRow(");
		// Rows are keyed by their section, so a move reorders the same nodes.
		assert.match(page, /<li\s[^>]*key=\{row\.key\}/);
		assert.notMatch(page, /\bkey=\{`?(look|JSON)/);
	});

	test("the sections list's error is tied to the list, and the form row cannot be unchecked", async ({
		assert,
	}) => {
		const page = await read("pages/settings/look.tsx");
		assert.match(
			page,
			/<FieldError\s+id="sections-error">\s*\{error\}\s*<\/FieldError>/,
		);
		assert.include(page, "sections-help sections-error");
		assert.include(page, "REQUIRED_SECTION");
		assert.include(page, "Always shown");
	});

	test("Remove logo asks first, and says what happens", async ({ assert }) => {
		const form = await read("components/logo_form.tsx");
		assert.include(form, "window.confirm(REMOVE_LOGO_QUESTION)");
		assert.include(form, "tenant.settings.logo.destroy");
	});
});
