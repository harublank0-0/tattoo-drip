/** The default theme's recorded markup (TAT-54), shared by the tests that compare against it. */
export const SNAPSHOT_FILE = new URL(
	"./default-theme.snapshot.json",
	import.meta.url,
);

/** Where two renders first differ, with a little of each around it. */
export function firstDifference(actual: string, expected = ""): string {
	let index = 0;
	while (
		index < actual.length &&
		index < expected.length &&
		actual[index] === expected[index]
	) {
		index += 1;
	}
	const from = Math.max(0, index - 40);
	return `first difference at ${index}: expected "${expected.slice(from, index + 80)}", got "${actual.slice(from, index + 80)}"`;
}
