import { useState } from "react";
import {
	followStored,
	type SectionKey,
	type SectionRow,
	sectionRows,
} from "./page_look.js";

/**
 * A radio group's choice on Page look (TAT-56 fix round 4): the stored value
 * until the owner picks another, and it follows a changed stored value in place
 * (`followStored`), never by a key (a remount drops focus). Without this an
 * uncontrolled group with `defaultValue` ignored fresher data, such as the look
 * another tab saved coming back when this tab removed its logo, and a later
 * colour-only save sent the old font and order. Imports only React and the
 * pure rule, so the unit tests load it (with jsdom, see docs/testing.md).
 */
export function useStoredChoice<T extends string>(
	stored: T,
): [T, (next: string) => void] {
	const [picked, setPicked] = useState<T>(stored);
	const [seen, setSeen] = useState<T>(stored);
	if (seen !== stored) {
		setSeen(stored);
		setPicked(followStored(picked, stored, seen));
	}
	return [picked, (next) => setPicked(next as T)];
}

/**
 * The sections list's rows on Page look (TAT-126): the shown sections in their
 * order, then the hidden ones, as the owner has changed them, until the stored
 * list changes (compared as its comma string, so a new array with the same
 * sections is not a change): then the stored list. Like `useStoredChoice`, it
 * follows a changed stored list in place and never by a key, because a remount
 * drops focus.
 */
export function useStoredRows(
	stored: readonly SectionKey[],
	all: readonly SectionKey[],
): [SectionRow[], (rows: SectionRow[]) => void] {
	const storedText = stored.join(",");
	const [rows, setRows] = useState(() => sectionRows(stored, all));
	const [seen, setSeen] = useState(storedText);
	if (seen !== storedText) {
		setSeen(storedText);
		setRows(sectionRows(stored, all));
	}
	return [rows, setRows];
}
