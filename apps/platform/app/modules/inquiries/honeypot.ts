/**
 * The intake form's honeypot (TAT-55): a text field people never see (the
 * form hides it off-screen, out of the tab order and from screen readers),
 * so a person leaves it empty and a form-filling bot doesn't.
 */
export const HONEYPOT_FIELD = "website";

/**
 * Whether the honeypot was filled: a string with something besides
 * whitespace, any part of several sent under that name, or any other value
 * (a nested field). Missing, empty or blank is a person's.
 */
export function honeypotFilled(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === "string") return value.trim() !== "";
	if (Array.isArray(value)) return value.some(honeypotFilled);
	return true;
}
