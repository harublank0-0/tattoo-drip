import { readFileSync } from "node:fs";
import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `StudioContentModule` below restates its shape and the inertia project type-checks the real one.
import * as studioContentModule from "../../../inertia/components/studio_content.js";

type ListRow = { key: number; a: string; b: string };
type Pair = { a: string; b: string };
type StudioContentModule = {
	rowsFrom(pairs: readonly Pair[], next: () => number): ListRow[];
	moveListRow(
		rows: ListRow[],
		index: number,
		direction: "up" | "down",
	): ListRow[];
	syncRows(
		rows: readonly ListRow[],
		stored: readonly Pair[],
		next: () => number,
	): ListRow[];
};
const { rowsFrom, moveListRow, syncRows } =
	studioContentModule as StudioContentModule;

/**
 * The FAQ & policies editor's rows (Settings → FAQ & policies): each row
 * keeps its own key when it moves, so focus and errors follow the row, and
 * a save re-syncs the rows without remounting the card.
 */

const pairs = [
	{ a: "One?", b: "1" },
	{ a: "Two?", b: "2" },
	{ a: "Three?", b: "3" },
];

test.group("studio content list rows", () => {
	test("rowsFrom gives each pair its own key", ({ assert }) => {
		let next = 0;
		const rows = rowsFrom(pairs, () => next++);
		assert.deepEqual(
			rows.map((row) => row.key),
			[0, 1, 2],
		);
		assert.deepEqual(rows[1], { key: 1, a: "Two?", b: "2" });
	});

	test("a moved row keeps its key; a row at the edge does not move", ({
		assert,
	}) => {
		let next = 0;
		const rows = rowsFrom(pairs, () => next++);
		const up = moveListRow(rows, 2, "up");
		assert.deepEqual(
			up.map((row) => [row.key, row.a]),
			[
				[0, "One?"],
				[2, "Three?"],
				[1, "Two?"],
			],
		);
		assert.strictEqual(moveListRow(rows, 0, "up"), rows);
		assert.strictEqual(moveListRow(rows, 2, "down"), rows);
	});

	test("after a save the rows take the stored text and keep their keys by place", ({
		assert,
	}) => {
		let next = 0;
		const rows: ListRow[] = rowsFrom(pairs, () => next++);
		const synced = syncRows(
			rows,
			[
				{ a: "One?", b: "1" },
				{ a: "Two? (trimmed)", b: "2" },
			],
			() => next++,
		);
		assert.deepEqual(synced, [
			{ key: 0, a: "One?", b: "1" },
			{ key: 1, a: "Two? (trimmed)", b: "2" },
		]);
		// A longer stored list gives the new rows new keys.
		const longer = syncRows(synced, pairs, () => next++);
		assert.deepEqual(
			longer.map((row) => row.key),
			[0, 1, 3],
		);
	});
});

test.group("the FAQ & policies page source", () => {
	const source = readFileSync(
		new URL(
			"../../../inertia/pages/settings/faq_policies.tsx",
			import.meta.url,
		),
		"utf8",
	);

	test("rows are keyed by their own key, not their place, and the card is not remounted by a save", ({
		assert,
	}) => {
		assert.include(source, "key={row.key}");
		assert.notInclude(source, "key={n}");
		assert.notMatch(source, /key=\{`(faq|policies):\$\{JSON\.stringify/);
	});

	test("a move sends focus after the moved row and clears the errors; a remove clears them too", ({
		assert,
	}) => {
		assert.include(source, "focusAfterMove(");
		assert.match(source, /clearErrors\(\)/);
	});

	test("Save is never disabled, so focus stays on it across a save", ({
		assert,
	}) => {
		assert.notMatch(source, /type="submit"[^>]*disabled=/);
		assert.include(source, "if (form.processing) return;");
	});

	test("a save re-syncs the rows from the server's answer", ({ assert }) => {
		assert.include(source, "syncRows(");
		assert.include(source, "setDefaults(");
	});
});
