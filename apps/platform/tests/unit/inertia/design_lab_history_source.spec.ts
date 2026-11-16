import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";

const read = (file: string) =>
	readFile(new URL(`../../../inertia/${file}`, import.meta.url), "utf8");

// Final review fix: paging is an Inertia visit to the same component, so
// uncontrolled filter selects keep a choice that was never applied ("Failed"
// over every row). Keying the form on the applied filters and page remounts
// it on every visit. Playwright is not in CI, so the key is pinned here.
test.group("The Design Lab history's filters", () => {
	test("the filter form remounts whenever the applied filters or the page change", async ({
		assert,
	}) => {
		const source = await read("pages/design_lab/history.tsx");
		const form = source.match(/<form\b[^>]*>/s)?.[0] ?? "";

		assert.isNotEmpty(form, "the filter form is there");
		const key = form.match(/\bkey=\{([^}]*)\}/)?.[1] ?? "";
		for (const part of [
			"filters.month",
			"filters.artist",
			"filters.status",
			"page",
		]) {
			assert.include(key, part, `the form's key names ${part}`);
		}
	});
});
