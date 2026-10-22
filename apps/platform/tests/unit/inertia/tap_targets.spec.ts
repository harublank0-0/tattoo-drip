import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";

const read = (file: string) =>
	readFile(
		new URL(`../../../inertia/components/ui/${file}`, import.meta.url),
		"utf8",
	);

/** `name: "classes"` entries (the name may be quoted, the value on the next line) of the `size` variants. */
function buttonSizes(source: string): Record<string, string> {
	const start = source.indexOf("size: {");
	const end = source.indexOf("\t\t},", start);
	const block = source.slice(start, end);
	const sizes: Record<string, string> = {};
	for (const [, quoted, bare, classes] of block.matchAll(
		/(?:"([\w-]+)"|^\t\t\t\t(\w+)):\s*"([^"]*)"/gm,
	)) {
		sizes[(quoted ?? bare) as string] = classes as string;
	}
	return sizes;
}

// docs/ui.md: touch targets are at least 44px. A pure CSS rule, so a browser
// measures the real heights; this pins the rule in the shared components, where
// a new size or control would otherwise slip back to shadcn's 36px unnoticed.
test.group("44px tap targets below lg (TAT-103)", () => {
	test("every button size is 44px below lg and keeps its compact size from lg", async ({
		assert,
	}) => {
		const sizes = buttonSizes(await read("button.tsx"));
		assert.sameMembers(Object.keys(sizes), [
			"default",
			"xs",
			"sm",
			"lg",
			"icon",
			"icon-xs",
			"icon-sm",
			"icon-lg",
		]);
		for (const [size, classes] of Object.entries(sizes)) {
			const square = size.startsWith("icon");
			assert.match(
				classes,
				square ? /max-lg:size-11\b/ : /max-lg:min-h-11\b/,
				`${size} is 44px below lg`,
			);
			// The compact size stays plain (not under `max-lg:`), so from lg
			// the dashboard keeps its density.
			assert.match(
				classes,
				square ? /(^| )size-\d/ : /(^| )h-\d/,
				`${size} keeps a compact size from lg`,
			);
		}
	});

	test("inputs and select triggers are 44px below lg", async ({ assert }) => {
		assert.include(await read("input.tsx"), "max-lg:min-h-11");
		assert.include(await read("select.tsx"), "max-lg:min-h-11");
	});

	test("menu items are 44px below lg", async ({ assert }) => {
		assert.include(await read("dropdown-menu.tsx"), "max-lg:min-h-11");
	});

	test("checkboxes and radios have a 44px hit area below lg", async ({
		assert,
	}) => {
		// The mark stays 16px; an invisible box around it is the target.
		for (const file of ["checkbox.tsx", "radio-group.tsx"]) {
			const source = await read(file);
			assert.include(source, "max-lg:relative", file);
			assert.include(source, "max-lg:after:absolute", file);
			assert.include(source, "max-lg:after:-inset-3.75", file);
		}
	});
});
