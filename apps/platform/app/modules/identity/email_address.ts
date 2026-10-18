/**
 * The one form an account's email address is stored and looked up in
 * (TAT-18): surrounding whitespace removed and the ASCII letters A to Z in
 * lower case. Nothing else changes. Other scripts keep their case: only
 * this rule is the same in JavaScript and in every Postgres locale (the
 * users_email_canonical check uses translate(), never lower()). Dots and
 * +tags stay, since what they mean depends on the provider. Never use
 * Vine's normalizeEmail() for accounts: it drops Gmail dots and +tags.
 */
export function canonicalEmail(value: string): string {
	return value.trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
