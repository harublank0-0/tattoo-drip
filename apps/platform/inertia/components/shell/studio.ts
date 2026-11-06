/**
 * The studio's identity in the shell (Studio OS). Plain data, so the unit
 * tests can load it.
 */

/**
 * The studio's monogram when it has no logo: the first letter of its first
 * two words ("Black Needle" is "BN", "Ink" is "I"), whole characters only, so
 * a Devanagari name keeps its first letter with its vowel sign.
 */
export function monogram(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const letters = words.slice(0, 2).map((word) => firstLetter(word));
	return letters.join("").toLocaleUpperCase();
}

function firstLetter(word: string): string {
	if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
		const segmenter = new Intl.Segmenter(undefined, {
			granularity: "grapheme",
		});
		const [first] = segmenter.segment(word);
		return first?.segment ?? "";
	}
	return Array.from(word)[0] ?? "";
}

/** What a member's role is called next to the studio's name. */
export const ROLE_LABELS: Record<string, string> = {
	owner: "Owner",
	artist: "Artist",
};
