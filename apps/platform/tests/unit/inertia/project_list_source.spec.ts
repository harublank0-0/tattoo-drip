import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";

const page = () =>
	readFile(
		new URL("../../../inertia/pages/projects/index.tsx", import.meta.url),
		"utf8",
	);

/** The source between `from` and the next `to` after it. */
function between(source: string, from: string, to: string): string {
	const start = source.indexOf(from);
	if (start === -1) throw new Error(`${from} is not in the page`);
	return source.slice(start, source.indexOf(to, start));
}

// What the browser check (focus stays on the activated control, keyboard only) cannot
// guard in a unit run: the markup of the two sort controls (TAT-109). A source scan,
// kept to structure. Activating a sort is an Inertia visit; the page then re-renders in
// place only when the visit keeps its state (`preserveState`) and the activated element
// is the same element afterwards (a link stays a link, the selected one is marked with
// `aria-current`, never swapped for a plain `span`), or keyboard focus falls to <body>.
test.group(
	"the Projects list's sort controls keep keyboard focus (TAT-109)",
	() => {
		test("the phone's two sorts are both links, one element for each choice, kept mounted", async ({
			assert,
		}) => {
			const block = between(
				await page(),
				'aria-label="Sort projects"',
				"</nav>",
			);
			assert.include(block, "<Link");
			assert.include(block, "preserveState");
			assert.include(block, "aria-current");
			// One element renders every choice: nothing is swapped for the selected one.
			assert.lengthOf(block.match(/<Link\b/g) ?? [], 1);
			// The only span left is the "Sort:" label.
			assert.lengthOf(block.match(/<span\b/g) ?? [], 1);
			assert.notMatch(block, /===\s*sort\s*\?\s*\(?\s*</);
		});

		test("the table's sort heads are links that keep the page's state and are never swapped on activation", async ({
			assert,
		}) => {
			const source = await page();
			const head = source.slice(source.indexOf("function SortHead"));
			assert.include(head, "<Link");
			assert.include(head, "preserveState");
			assert.include(head, "aria-sort");
			assert.notInclude(head, "<button");
			// The sorted and the unsorted head are the same element: only the icon differs.
			assert.notMatch(head, /sorted\s*\?\s*\(?\s*</);
		});
	},
);
