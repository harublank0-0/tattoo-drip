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

/** The source of one component function, so an assertion can't pass by matching another one in the file. */
function component(source: string, name: string): string {
	const start = source.indexOf(`function ${name}(`);
	if (start === -1) throw new Error(`no function ${name}`);
	const next = source.indexOf("\nfunction ", start + 1);
	return source.slice(start, next === -1 ? undefined : next);
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

	test("inputs, select triggers and select items are 44px below lg", async ({
		assert,
	}) => {
		const select = await read("select.tsx");
		assert.include(component(select, "SelectTrigger"), "max-lg:min-h-11");
		assert.include(component(select, "SelectItem"), "max-lg:min-h-11");
		assert.include(
			component(await read("input.tsx"), "Input"),
			"max-lg:min-h-11",
		);
	});

	test("every menu row is 44px below lg", async ({ assert }) => {
		const menu = await read("dropdown-menu.tsx");
		for (const name of [
			"DropdownMenuItem",
			"DropdownMenuCheckboxItem",
			"DropdownMenuRadioItem",
			"DropdownMenuSubTrigger",
		]) {
			assert.include(component(menu, name), "max-lg:min-h-11", name);
		}
	});

	test("checkboxes and radios have a 44px hit area below lg", async ({
		assert,
	}) => {
		// The mark stays 16px; an invisible box around it is the target.
		for (const [file, name] of [
			["checkbox.tsx", "Checkbox"],
			["radio-group.tsx", "RadioGroupItem"],
		] as const) {
			const source = component(await read(file), name);
			assert.include(source, "max-lg:relative", name);
			assert.include(source, "max-lg:after:absolute", name);
			assert.include(source, "max-lg:after:-inset-3.75", name);
		}
	});
});
