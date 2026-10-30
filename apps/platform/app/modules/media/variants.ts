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
/**
 * A studio's cover photo (TAT-116): copies 640, 960, 1280 and 1600 px wide.
 * The hero is about 329 px wide on a phone, so a phone at 2x to 2.75x takes
 * the 960 copy (about half the bytes of the 1280 one) and a 4:3 photo at 3x
 * the 1280 one. A 16:9 photo is enlarged to fill the phone's 4:3 box, so at
 * 3x it needs about 1320 px: without the 1600 copy the browser took the
 * stored 2048 px image (428 KB for a detailed photo). A wide screen takes the
 * 1280 or the 1600 one.
 */
export const COVER_WIDTHS = [640, 960, 1280, 1600] as const;
/**
 * A studio logo's square icon (TAT-123): one copy, 32 px, the browser tab's
 * copy of the 180 px icon.
 */
export const ICON_WIDTHS = [32] as const;
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

/** The base and extension of an image's own key, whether or not it names copies. */
const IMAGE_KEY = /^([^.]+)(?:\.[1-9]\d{0,3}(?:-[1-9]\d{0,3})*)?\.(jpg|png)$/;

/**
 * The key of every copy an image could have for these widths, named or not
 * (TAT-116 fix round 2): `[]` for a key that is not an image's own (a copy's
 * key, anything malformed). A key names the copies that were written, but an
 * upload whose copy cleanup failed is stored under a plain key while a copy
 * stays on the disk, so removing an image must look for every width its
 * purpose could have made, not only the ones its key names.
 */
export function possibleCopyKeys(
	key: string,
	widths: readonly number[],
): string[] {
	const match = IMAGE_KEY.exec(key);
	if (!match) return [];
	const [, base, extension] = match;
	return widths.map((width) =>
		variantKey(base, width, extension as ImageExtension),
	);
}
