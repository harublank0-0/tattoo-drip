import type { ImageSize } from "../../srcset.ts";

/*
 * `sizes` for Irezumi's photos (styles.css, pages.css). Irezumi draws a
 * tattoo whole (`object-fit: contain`, never a crop): a photo is as wide as
 * its box unless the box's height cap makes it narrower, so each value is the
 * smaller of the box's width and the cap times the photo's shape (`min()`).
 * Both are upper bounds (the mat's padding and the grid's gaps only ever make
 * the drawn photo smaller), so the browser never fetches too small a copy.
 * The page column is min(76rem, 100% - 2.5rem), reached at 78.5rem.
 */
const COLUMN_REM = 76;
const GUTTER_REM = 2.5;
const WIDE_FROM = COLUMN_REM + GUTTER_REM;
/** `.irz-pieces`: one column, two from 40rem, three from 64rem, with these gaps. */
const PIECE_GAP_REM = { two: 1.5, three: 2.5 };

/** Rounded up to a hundredth: a little more only ever costs the next copy. */
function round(value: number): number {
	return Math.ceil(Number((value * 100).toFixed(6))) / 100;
}

/** A share of the column, less `gapRem`, at every width. */
function columnShare(
	share: number,
	gapRem = 0,
): [wide: string, narrow: string] {
	return [
		`${round((COLUMN_REM - gapRem) * share)}rem`,
		`calc((100vw - ${GUTTER_REM + gapRem}rem) * ${round(share)})`,
	];
}

/**
 * The widest a photo can be drawn under a height cap of `vh` (and `rem`,
 * when the cap is also a length): the cap times the photo's width over its
 * height.
 */
function capOf(image: ImageSize, vh: number, rem: number | null): string[] {
	const shape = image.width / image.height;
	return [
		`calc(${vh}vh * ${round(shape)})`,
		...(rem === null ? [] : [`${round(rem * shape)}rem`]),
	];
}

/** `box`, or the cap when it is narrower. */
function capped(box: string, cap: readonly string[]): string {
	return `min(${[box, ...cap].join(", ")})`;
}

/**
 * A piece in the grid (`.irz-pieces`): a third, a half or the whole of the
 * column, and at most 72svh tall (`.irz-piece-photo`).
 */
export function pieceSizes(image: ImageSize): string {
	const cap = capOf(image, 72, null);
	const [wide, three] = columnShare(1 / 3, 2 * PIECE_GAP_REM.three);
	const [, two] = columnShare(1 / 2, PIECE_GAP_REM.two);
	return [
		`(min-width: ${WIDE_FROM}rem) ${capped(wide, cap)}`,
		`(min-width: 64rem) ${capped(three, cap)}`,
		`(min-width: 40rem) ${capped(two, cap)}`,
		capped(`calc(100vw - ${GUTTER_REM}rem)`, cap),
	].join(", ");
}

/**
 * The lead photo of the home page and of an artist's page: the column's
 * width on a phone, and from 60rem 7/12 of it (the text takes the rest); at
 * most min(78svh, 52rem) tall (`.irz-hero-photo`, `.irz-artist-lead-photo`).
 */
export function leadSizes(image: ImageSize): string {
	const cap = capOf(image, 78, 52);
	const [wide, narrow] = columnShare(7 / 12);
	return [
		`(min-width: ${WIDE_FROM}rem) ${capped(wide, cap)}`,
		`(min-width: 60rem) ${capped(narrow, cap)}`,
		capped(`calc(100vw - ${GUTTER_REM}rem)`, cap),
	].join(", ");
}

/**
 * A tattoo's own page: the photo takes 8/12 of the column from 60rem, the
 * column below; at most min(82svh, 60rem) tall (`.irz-artwork-figure`).
 */
export function artworkSizes(image: ImageSize): string {
	const cap = capOf(image, 82, 60);
	const [wide, narrow] = columnShare(8 / 12);
	return [
		`(min-width: ${WIDE_FROM}rem) ${capped(wide, cap)}`,
		`(min-width: 60rem) ${capped(narrow, cap)}`,
		capped(`calc(100vw - ${GUTTER_REM}rem)`, cap),
	].join(", ");
}

/** How much wider than its box a photo is drawn when it covers a box `ratio` (height / width) tall. */
function coverFactor(ratio: number, image: ImageSize): number {
	return Math.max(1, (ratio * image.width) / image.height);
}

/**
 * An artist's portrait in the directory and on the home page: a 4:5 box,
 * cropped (`object-fit: cover`: a portrait is a person, not a composition),
 * 9rem wide on a phone and 14rem from 48rem.
 */
export function portraitSizes(image: ImageSize): string {
	const factor = coverFactor(5 / 4, image);
	return `(min-width: 48rem) ${round(14 * factor)}rem, ${round(9 * factor)}rem`;
}

/** The small portrait beside an artist's name on their own page and a tattoo's: 5rem, 4:5. */
export function smallPortraitSizes(image: ImageSize): string {
	return `${round(5 * coverFactor(5 / 4, image))}rem`;
}

/**
 * A preview of an artist's work in the directory (`.irz-artist-previews`):
 * drawn whole in a cell at most 6rem wide (8rem from 48rem).
 */
export function previewSizes(): string {
	return "(min-width: 48rem) 8rem, 6rem";
}
