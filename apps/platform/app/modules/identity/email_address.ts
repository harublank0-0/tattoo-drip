/**
 * The one form an account's email address is stored and looked up in
 * (TAT-18): spaces (U+0020) removed at both ends and the ASCII letters A to
 * Z in lower case. Nothing else changes. This is exactly what the
 * users_email_canonical check computes, `translate(btrim(email), …)`, whose
 * btrim() strips only U+0020 and whose translate() maps only A to Z, so the
 * rule is the same in JavaScript and in every Postgres locale (never lower()).
 * Other whitespace (tabs, line breaks, U+00A0, U+3000) is not removed here:
 * the validator's trim() cleans it from typed input before this runs (see
 * `accountEmail()` in #validators/user); use `typedEmail()` for a raw typed
 * value. Other scripts keep their case. Dots and +tags stay, since what they
 * mean depends on the provider. Never use Vine's normalizeEmail() for
 * accounts: it drops Gmail dots and +tags.
 */
export function canonicalEmail(value: string): string {
	// Loops, not a /^ +| +$/ regex: a long run of spaces would backtrack.
	let start = 0;
	let end = value.length;
	while (start < end && value.charCodeAt(start) === 0x20) start++;
	while (end > start && value.charCodeAt(end - 1) === 0x20) end--;
	return value.slice(start, end).replace(/[A-Z]/g, (l) => l.toLowerCase());
}

/**
 * The canonical form of an address as someone typed it: all surrounding
 * whitespace is dropped first, as the validator's trim() does, then
 * `canonicalEmail`. Use it where a raw request value or command argument
 * is compared with stored addresses or keyed (rate limits).
 */
export function typedEmail(value: string): string {
	return canonicalEmail(value.trim());
}
