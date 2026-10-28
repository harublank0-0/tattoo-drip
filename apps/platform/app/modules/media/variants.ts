/**
 * Smaller copies of stored images (TAT-112): their widths, and how keys name
 * them. Pure. A copy sits beside its image on the same disk, so it has the
 * image's visibility and origin; the names are plain object names, the same
 * on the local disk and on R2 (TAT-27).
 *
 *   tenants/<tenant>/<purpose>/<id>.jpg               no copies (every key before TAT-112)
 *   tenants/<tenant>/<purpose>/<id>.320-640-1280.jpg  an image whose key names its copies
 *   tenants/<tenant>/<purpose>/<id>.320w.jpg          its 320 px copy
 *
 * The owning record keeps the image's key only. Ids are random, so a
 * replaced image never shares a copy with the new one.
 */

/** The copies a purpose with copies gets, narrowest first. */
export const VARIANT_WIDTHS = [320, 640, 1280] as const;
/** A purpose that keeps one size. */
export const NO_VARIANTS = [] as const;

/** At most this many copies are read from a key (the contract's maxItems). */
const MAX_VARIANTS = 8;

export type ImageExtension = "jpg" | "png";

/** The widths of `widths` below `width`: an image is never enlarged. */
export function variantWidths(
	width: number,
	widths: readonly number[],
): number[] {
	return widths.filter((candidate) => candidate < width);
}

/** The key of an image whose copies have these widths; none is the old form. */
export function originalKey(
	base: string,
	extension: ImageExtension,
	widths: readonly number[],
): string {
	return widths.length === 0
		? `${base}.${extension}`
		: `${base}.${widths.join("-")}.${extension}`;
}

/** The key of the image's copy that is `width` px wide. */
export function variantKey(
	base: string,
	width: number,
	extension: ImageExtension,
): string {
	return `${base}.${width}w.${extension}`;
}

/** The base (no dot in it, so no ".."), the widths, the extension. */
const NAMED = /^([^.]+)\.([1-9]\d{0,3}(?:-[1-9]\d{0,3})*)\.(jpg|png)$/;

/**
 * The copies an image's key names, narrowest first, each with its own key;
 * [] for a key that names none: the old form, a copy's own key, or anything
 * malformed (widths not strictly increasing, more than 8, another extension).
 */
export function variantsOfKey(key: string): { width: number; key: string }[] {
	const match = NAMED.exec(key);
	if (!match) return [];
	const [, base, list, extension] = match;
	const widths = list.split("-").map(Number);
	if (
		widths.length > MAX_VARIANTS ||
		widths.some((width, index) => index > 0 && width <= widths[index - 1])
	) {
		return [];
	}
	return widths.map((width) => ({
		width,
		key: variantKey(base, width, extension as ImageExtension),
	}));
}
