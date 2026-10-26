import { readdir, readFile } from "node:fs/promises";
import { test } from "@japa/runner";

const read = (file: string) =>
	readFile(new URL(`../../../inertia/${file}`, import.meta.url), "utf8");

// TAT-108: the project and inquiry pages ask in the page, never in the browser's dialog. A source
// scan, because Playwright is not in CI; the behaviour itself (focus on the safe button, Escape,
// the sheet staying open on a refusal) is the pure steps in confirm_and_sheets.spec.ts and a
// browser pass.
test.group(
	"No window.confirm on the project and inquiry pages (TAT-108)",
	() => {
		test("the money and quote forms in sheets neither confirm nor use onBefore", async ({
			assert,
		}) => {
			for (const file of [
				"components/payments_card.tsx",
				"components/quote_card.tsx",
			]) {
				const source = await read(file);
				assert.notInclude(source, "window.confirm", file);
				assert.notMatch(source, /[^\w.]confirm\(/, file);
				assert.notInclude(source, "onBefore=", file);
			}
		});

		test("no project page, inquiry page or shared component calls the browser's confirm", async ({
			assert,
		}) => {
			const components = (
				await readdir(new URL("../../../inertia/components/", import.meta.url))
			)
				.filter((name) => name.endsWith(".tsx"))
				.map((name) => `components/${name}`);
			// pages/calendar has a confirm function of its own, and Settings and Artists still
			// ask with the browser's dialog (a follow-up), so they are not scanned.
			const files = [
				"pages/projects/show.tsx",
				"pages/inquiries/show.tsx",
				...components,
			];
			assert.isAbove(components.length, 10);
			for (const file of files) {
				const source = await read(file);
				assert.notInclude(source, "window.confirm", file);
				assert.notMatch(source, /[^\w.]confirm\(/, file);
			}
		});
	},
);
