/**
 * Colour arithmetic for a studio's brand colours (TAT-54). Pure. Every
 * colour here is "#rrggbb" in lowercase: readHexColor (config.ts) is the only
 * way a studio's value gets in, and anything else throws.
 */

/** WCAG 2.x AA: the least contrast for text of body size. */
export const MIN_TEXT_CONTRAST = 4.5;

const HEX = /^#[0-9a-f]{6}$/;

function channels(color: string): number[] {
	if (!HEX.test(color)) throw new Error("Not a #rrggbb colour.");
	return [1, 3, 5].map((start) =>
		Number.parseInt(color.slice(start, start + 2), 16),
	);
}

/** WCAG 2.x relative luminance: 0 for black, 1 for white. */
export function relativeLuminance(color: string): number {
	const [r, g, b] = channels(color).map((value) => {
		const c = value / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, from 1 (the same) to 21 (black on white), in either order. */
export function contrastRatio(a: string, b: string): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `from` moved `amount` (0 to 1) of the way to `to`, channel by channel. */
export function mixColors(from: string, to: string, amount: number): string {
	const target = channels(to);
	const mixed = channels(from).map((value, index) =>
		Math.round(value + (target[index] - value) * amount),
	);
	return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
