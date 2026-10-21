/**
 * Characters a terminal would obey instead of print: the C0 controls (ESC,
 * CR, LF, TAB, NUL ...), DEL and the C1 controls (`\p{Cc}`), the Unicode
 * line and paragraph separators, and the bidirectional overrides and marks
 * that can reorder what the operator reads. Zero-width joiners stay: Devanagari
 * needs them.
 */
const UNSAFE = /[\p{Cc}\p{Zl}\p{Zp}؜‎‏‪-‮⁦-⁩]/gu;

/**
 * Text someone else typed (a studio's name), made safe to print to an
 * operator's terminal: each character it would obey is shown as `\xNN` or
 * `\u{NNNN}`, so the operator can see it was there; letters and marks of any
 * script come through unchanged. Apply it where the text is printed, so
 * what is already stored is covered too.
 */
export function terminalText(text: string): string {
	return text.replace(UNSAFE, (char) => {
		const code = char.codePointAt(0) ?? 0;
		return code <= 0xff
			? `\\x${code.toString(16).padStart(2, "0")}`
			: `\\u{${code.toString(16)}}`;
	});
}
