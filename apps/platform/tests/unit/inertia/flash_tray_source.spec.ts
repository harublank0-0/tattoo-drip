import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";

const read = (file: string) =>
	readFile(new URL(`../../../inertia/${file}`, import.meta.url), "utf8");

// TAT-129 review fix: the tray sits on the artist form, outside the profile
// <Form>, and is saved by its own requests (like the work photos). Playwright
// is not in CI, so what keeps the two apart is pinned in the source.
test.group("The flash tray's visits (TAT-129)", () => {
	test("adding a design keeps the page's state, so unsaved profile edits and a chosen photo survive, and resets only its own form", async ({
		assert,
	}) => {
		const source = await read("components/flash_tray.tsx");
		const add = source.match(
			/<Form\s+route="tenant\.artists\.flash\.store"[^>]*>/,
		);

		assert.isNotNull(add, "the add form is there");
		const form = add?.[0] ?? "";
		assert.match(form, /options=\{\{[^}]*preserveState: true[^}]*\}\}/);
		assert.match(form, /options=\{\{[^}]*preserveScroll: true[^}]*\}\}/);
		assert.match(form, /\bresetOnSuccess\b/);
	});

	test('no visit of the tray remounts the page after a success: preserveState: "errors" would discard the artist form\'s unsaved fields', async ({
		assert,
	}) => {
		const source = await read("components/flash_tray.tsx");

		assert.notMatch(source, /preserveState:\s*["']errors["']/);
	});
});
