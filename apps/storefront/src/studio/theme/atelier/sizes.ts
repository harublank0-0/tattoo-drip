import type { ImageSize } from "../../srcset.ts";

/*
 * `sizes` for Atelier's photos (styles.css, pages.css). A tattoo is drawn
 * whole (`object-fit: contain`) on a mat: the box's width, or less when the
 * box's height cap makes the photo narrower (`min()`). Upper bounds: the
 * mat's padding only ever makes the photo smaller. The page column is
 * min(70rem, 100% - 3rem), reached at 73rem.
 */
const COLUMN_REM = 70;
const GUTTER_REM = 3;
const WIDE_FROM = COLUMN_REM + GUTTER_REM;
/** `.atl-pieces`: one column, two from 48rem with this gap. */
const PIECE_GAP_REM = 3;
/** The centred plates (the home page's and an artist's lead, a piece's own page): at most this wide. */
const PLATE_REM = 52;

function round(value: number): number {
	return Math.ceil(Number((value * 100).toFixed(6))) / 100;
}

/** The widest a photo is drawn under a height cap of `vh` (and `rem`): the cap times its shape. */
function capOf(image: ImageSize, vh: number, rem: number | null): string[] {
	const shape = image.width / image.height;
	return [
		`calc(${vh}vh * ${round(shape)})`,
		...(rem === null ? [] : [`${round(rem * shape)}rem`]),
	];
}

function capped(box: string, cap: readonly string[]): string {
	return `min(${[box, ...cap].join(", ")})`;
}

/** A piece in the catalogue (`.atl-pieces`): half the column from 48rem, the column below; at most 70svh tall. */
export function pieceSizes(image: ImageSize): string {
	const cap = capOf(image, 70, null);
	const half = round((COLUMN_REM - PIECE_GAP_REM) / 2);
	return [
		`(min-width: ${WIDE_FROM}rem) ${capped(`${half}rem`, cap)}`,
		`(min-width: 48rem) ${capped(`calc((100vw - ${GUTTER_REM + PIECE_GAP_REM}rem) / 2)`, cap)}`,
		capped(`calc(100vw - ${GUTTER_REM}rem)`, cap),
	].join(", ");
}

/** A centred plate: at most 52rem wide (the column below that), at most min(78svh, 50rem) tall. */
export function leadSizes(image: ImageSize): string {
	const cap = capOf(image, 78, 50);
	return [
		`(min-width: ${PLATE_REM + GUTTER_REM}rem) ${capped(`${PLATE_REM}rem`, cap)}`,
		capped(`calc(100vw - ${GUTTER_REM}rem)`, cap),
	].join(", ");
}

/** A piece's own page: the same centred plate, at most min(82svh, 60rem) tall. */
export function artworkSizes(image: ImageSize): string {
	const cap = capOf(image, 82, 60);
	return [
		`(min-width: ${PLATE_REM + GUTTER_REM}rem) ${capped(`${PLATE_REM}rem`, cap)}`,
		capped(`calc(100vw - ${GUTTER_REM}rem)`, cap),
	].join(", ");
}

function coverFactor(ratio: number, image: ImageSize): number {
	return Math.max(1, (ratio * image.width) / image.height);
}

/**
 * An artist's portrait in an arch (4:5, cropped: a person, not a
 * composition): a quarter of the column from 64rem, a half from 36rem, the
 * column on a small phone, at most 16rem.
 */
export function portraitSizes(image: ImageSize): string {
	const factor = coverFactor(5 / 4, image);
	return `(min-width: 36rem) ${round(16 * factor)}rem, ${capped(`calc(100vw - ${GUTTER_REM}rem)`, [`${round(16 * factor)}rem`])}`;
}

/** The arch on an artist's own page and a piece's: 10rem, 4:5. */
export function smallPortraitSizes(image: ImageSize): string {
	return `${round(10 * coverFactor(5 / 4, image))}rem`;
}

/** A preview of an artist's work: drawn whole in a cell at most 6rem wide. */
export function previewSizes(): string {
	return "6rem";
}
