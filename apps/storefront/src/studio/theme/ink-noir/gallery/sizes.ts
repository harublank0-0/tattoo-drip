import type { GalleryPhotoView } from "../../../gallery.ts";

/**
 * The gallery's justified rows (gallery.css): each piece's width follows its
 * photo's shape, so no photo is cropped and a row's pieces share a height.
 * The shape is one of 31 classes, `ink-ar-50` (1:2, tall) to `ink-ar-200`
 * (2:1, wide) in steps of 0.05: a class, never an inline style (the pages
 * carry no `style` attribute).
 */
const MIN_RATIO = 0.5;
const MAX_RATIO = 2;

/** The photo's width over its height, rounded to 0.05 and kept within 1:2 to 2:1. */
export function shapeOf(photo: { width: number; height: number }): number {
	const ratio = photo.width / photo.height;
	const stepped = Math.round(ratio * 20) / 20;
	return Math.min(MAX_RATIO, Math.max(MIN_RATIO, stepped));
}

/** The piece's shape class (gallery.css). */
export function shapeClass(photo: { width: number; height: number }): string {
	return `ink-ar-${Math.round(shapeOf(photo) * 100)}`;
}

/**
 * A piece's `sizes`: its row's height (15 or 19 rem, about 36vw on a
 * phone: gallery.css) times its shape, plus the share of a row's spare width
 * it may take.
 */
export function pieceSizes(photo: GalleryPhotoView): string {
	const shape = shapeOf(photo);
	const at = (row: number) => `${Math.ceil(row * shape * 1.3)}rem`;
	return `(min-width: 64rem) ${at(19)}, (min-width: 48rem) ${at(15)}, ${Math.min(100, Math.ceil(36 * shape * 1.3))}vw`;
}

/** The tattoo page's photo: about 58% of the 75 rem column on a wide screen, the width of a phone. */
export function artworkSizes(): string {
	return "(min-width: 75rem) 43rem, (min-width: 60rem) 58vw, 100vw";
}

/** The attribution's portrait: 12 rem. */
export function attributionSizes(): string {
	return "12rem";
}
