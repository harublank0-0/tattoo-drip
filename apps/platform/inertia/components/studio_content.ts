import { canMove, type MoveDirection } from "./page_look.js";

/**
 * The rows of Settings → FAQ & policies. Each row has its own `key`, so
 * React keeps a row's elements (and focus) with it when it moves, and the
 * rows survive a save without a remount. `a` and `b` are the question and
 * answer, or the title and text.
 */
export type ListRow = { key: number; a: string; b: string };
export type Pair = { a: string; b: string };

/** The stored pairs as rows, each with a new key. */
export function rowsFrom(
	pairs: readonly Pair[],
	next: () => number,
): ListRow[] {
	return pairs.map((pair) => ({ key: next(), ...pair }));
}

/** The rows with one moved a place earlier or later; the same rows when it cannot move. */
export function moveListRow(
	rows: ListRow[],
	index: number,
	direction: MoveDirection,
): ListRow[] {
	if (!canMove(index, rows.length, direction) || !rows[index]) return rows;
	const target = direction === "up" ? index - 1 : index + 1;
	const moved = [...rows];
	[moved[index], moved[target]] = [moved[target], moved[index]];
	return moved;
}

/**
 * The rows after a save: the stored text (trimmed by the server), each row
 * keeping the key of the row at its place, so focus stays where it was.
 */
export function syncRows(
	rows: readonly ListRow[],
	stored: readonly Pair[],
	next: () => number,
): ListRow[] {
	return stored.map((pair, n) => ({ key: rows[n]?.key ?? next(), ...pair }));
}
