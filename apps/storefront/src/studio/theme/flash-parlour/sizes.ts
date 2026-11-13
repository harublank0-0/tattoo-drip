import type { ImageSize } from "../../srcset.ts";

/*
 * `sizes` for Flash Parlour's pictures (pages.css). A tattoo photo or a flash
 * picture is drawn whole (`object-fit: contain`): its box's width, or less
 * when the box's height cap makes it narrower (`min()`). Upper bounds: a
 * sheet's padding and outline only ever make the picture smaller. The page
 * column is min(76rem, 100% - 2.5rem), reached at 78.5rem.
 */
const COLUMN_REM = 76;
const GUTTER_REM = 2.5;
const WIDE_FROM = COLUMN_REM + GUTTER_REM;

/** `.fp-flash-grid`: its gap; 2 columns, 3 from 40rem, 4 from 60rem, and on the home page's wall 6 from 80rem. */
const FLASH_GAP_REM = 1;
/** `.fp-pieces`: its gap; 1 column, 2 from 40rem, 3 from 64rem. */
const PIECE_GAP_REM = 2;
/** The two-column pages from 60rem (the first screen's lead, a piece's and a design's page): 7 parts of 12 for the picture, a 3rem gap. */
const SPLIT_GAP_REM = 3;
const SPLIT_SHARE = 7 / 12;
/** `.fp-artist-grid`: its gap; 1 column, 2 from 30rem, 3 from 52rem, 4 from 70rem. */
const ARTIST_GAP_REM = 1.5;

function round(value: number): number {
	return Math.ceil(Number((value * 100).toFixed(6))) / 100;
}

/** The viewport's width less the gutter and `gaps`, shared by `columns`. */
function columnCalc(columns: number, gaps: number, factor = 1): string {
	const less = round(GUTTER_REM + gaps);
	const share = round(factor / columns);
	return share === 1
		? `calc(100vw - ${less}rem)`
		: `calc((100vw - ${less}rem) * ${share})`;
}

/** The widest a picture is drawn under a height cap of `vh` (and `rem`): the cap times its shape. */
function capOf(image: ImageSize, vh: number, rem: number): string[] {
	const shape = image.width / image.height;
	return [`calc(${vh}vh * ${round(shape)})`, `${round(rem * shape)}rem`];
}

function capped(box: string, cap: readonly string[]): string {
	return `min(${[box, ...cap].join(", ")})`;
}

/**
 * A flash design on a sheet (`.fp-flash-grid`): a square cell, the picture
 * contained whole in it, so the cell's width is the most it needs. The home
 * page's wall (`wall`) takes six columns from 80rem.
 */
export function flashSheetSizes(wall: boolean): string {
	const four = round((COLUMN_REM - 3 * FLASH_GAP_REM) / 4);
	return [
		...(wall
			? [`(min-width: 80rem) ${round((COLUMN_REM - 5 * FLASH_GAP_REM) / 6)}rem`]
			: []),
		`(min-width: ${WIDE_FROM}rem) ${four}rem`,
		`(min-width: 60rem) ${columnCalc(4, 3 * FLASH_GAP_REM)}`,
		`(min-width: 40rem) ${columnCalc(3, 2 * FLASH_GAP_REM)}`,
		columnCalc(2, FLASH_GAP_REM),
	].join(", ");
}

/** A tattoo in the work grid (`.fp-pieces`): its column, at most 70svh tall. */
export function pieceSizes(image: ImageSize): string {
	const cap = capOf(image, 70, 48);
	return [
		`(min-width: ${WIDE_FROM}rem) ${capped(`${round((COLUMN_REM - 2 * PIECE_GAP_REM) / 3)}rem`, cap)}`,
		`(min-width: 64rem) ${capped(columnCalc(3, 2 * PIECE_GAP_REM), cap)}`,
		`(min-width: 40rem) ${capped(columnCalc(2, PIECE_GAP_REM), cap)}`,
		capped(columnCalc(1, 0), cap),
	].join(", ");
}

/** A picture in the wide half of a two-column page from 60rem (the column below), capped at `vh` and `rem` tall. */
function splitSizes(image: ImageSize, vh: number, rem: number): string {
	const cap = capOf(image, vh, rem);
	return [
		`(min-width: ${WIDE_FROM}rem) ${capped(`${round((COLUMN_REM - SPLIT_GAP_REM) * SPLIT_SHARE)}rem`, cap)}`,
		`(min-width: 60rem) ${capped(columnCalc(1, SPLIT_GAP_REM, SPLIT_SHARE), cap)}`,
		capped(columnCalc(1, 0), cap),
	].join(", ");
}

/** The first screen's photo when there is no flash: the cover, or the largest piece; at most min(75svh, 46rem) tall. */
export function leadSizes(image: ImageSize): string {
	return splitSizes(image, 75, 46);
}

/** A tattoo's own page: at most min(80svh, 48rem) tall. */
export function artworkSizes(image: ImageSize): string {
	return splitSizes(image, 80, 48);
}

/** A flash design's own page: at most min(80svh, 44rem) tall. */
export function designSizes(image: ImageSize): string {
	return splitSizes(image, 80, 44);
}

function coverFactor(ratio: number, image: ImageSize): number {
	return Math.max(1, (ratio * image.width) / image.height);
}

/**
 * An artist's portrait in their card (4:5, cropped: a person, not a
 * composition): a column of `.fp-artist-grid`; a photo wider than 4:5 is
 * drawn wider than its frame by how much flatter it is.
 */
export function portraitSizes(image: ImageSize): string {
	const factor = round(coverFactor(5 / 4, image));
	return [
		`(min-width: ${WIDE_FROM}rem) ${round(((COLUMN_REM - 3 * ARTIST_GAP_REM) / 4) * factor)}rem`,
		`(min-width: 70rem) ${columnCalc(4, 3 * ARTIST_GAP_REM, factor)}`,
		`(min-width: 52rem) ${columnCalc(3, 2 * ARTIST_GAP_REM, factor)}`,
		`(min-width: 30rem) ${columnCalc(2, ARTIST_GAP_REM, factor)}`,
		columnCalc(1, 0, factor),
	].join(", ");
}

/** A fixed-width portrait (`rem` wide, 4:5): the artist's page's 14rem, the piece page's 6rem. */
export function fixedPortraitSizes(image: ImageSize, rem: number): string {
	return `${round(rem * coverFactor(5 / 4, image))}rem`;
}
