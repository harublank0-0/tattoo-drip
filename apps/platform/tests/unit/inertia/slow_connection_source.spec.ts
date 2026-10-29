import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";

const read = (file: string) =>
	readFile(new URL(`../../../inertia/${file}`, import.meta.url), "utf8");

// TAT-84: Playwright is not in CI, so the in-flight states of the slow-connection pass are pinned
// at the source here and measured in a browser pass (the behaviour of the lost-connection toast
// and of the focus rule is the pure module in visits.spec.ts).
test.group("One-tap moves send once (TAT-84)", () => {
	test("MoveButton is disabled while saving, ignores a held Enter and sends from one place", async ({
		assert,
	}) => {
		const source = await read("components/change_card.tsx");
		for (const needle of [
			"export function MoveButton(",
			"sending.current",
			"disabled={saving}",
			'"Saving…"',
			"onKeyDown={ignoreHeldEnter}",
			"focusBack(",
		]) {
			assert.include(source, needle);
		}
		const card = source.slice(
			source.indexOf("const ask = CONFIRM[move]"),
			source.indexOf("export function MoveButton("),
		);
		assert.include(card, "<MoveButton");
		assert.notInclude(card, "onClick={() => post(move)}");
	});

	test("the Next step card's Resume is the same button", async ({ assert }) => {
		const source = await read("components/next_step_card.tsx");
		assert.include(source, "<MoveButton");
		assert.notInclude(source, "tenant.projects.moves.store");
	});

	test("the artist picker's Save says Saving… while it is out", async ({
		assert,
	}) => {
		const source = await read("components/change_card.tsx");
		const field = source.slice(source.indexOf("function ArtistField("));
		assert.include(field, 'processing ? "Saving…" : "Save"');
	});
});
