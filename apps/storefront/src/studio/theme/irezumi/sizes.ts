import type { ImageSize } from "../../srcset.ts";

/*
 * `sizes` for Irezumi's photos (styles.css, pages.css). Irezumi draws a
 * tattoo whole (`object-fit: contain`, never a crop), so a photo never needs
 * more width than its box: each value is the box's width. The page column is
 * min(76rem, 100% - 2.5rem), reached at 78.5rem.
 */
const COLUMN_REM = 76;
const GUTTER_REM = 2.5;
const WIDE_FROM = COLUMN_REM + GUTTER_REM;
/** `.irz-pieces`: one column, two from 40rem, three from 64rem, with these gaps. */
const PIECE_GAP_REM = { two: 1.5, three: 2.5 };

/** Rounded up to a hundredth of a rem: a little more only ever costs the next copy. */
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

/** A piece in the grid (`.irz-pieces`): a third, a half or the whole of the column. */
export function pieceSizes(): string {
	const [wide] = columnShare(1 / 3, 2 * PIECE_GAP_REM.three);
	const [, three] = columnShare(1 / 3, 2 * PIECE_GAP_REM.three);
	const [, two] = columnShare(1 / 2, PIECE_GAP_REM.two);
	return `(min-width: ${WIDE_FROM}rem) ${wide}, (min-width: 64rem) ${three}, (min-width: 40rem) ${two}, calc(100vw - ${GUTTER_REM}rem)`;
}

/**
 * The lead photo of the home page and of an artist's page: the column's
 * width on a phone, and from 60rem 7/12 of it (the text takes the rest).
 */
export function leadSizes(): string {
	const [wide, narrow] = columnShare(7 / 12);
	return `(min-width: ${WIDE_FROM}rem) ${wide}, (min-width: 60rem) ${narrow}, calc(100vw - ${GUTTER_REM}rem)`;
}

/** A tattoo's own page: the photo takes 8/12 of the column from 60rem, the column below. */
export function artworkSizes(): string {
	const [wide, narrow] = columnShare(8 / 12);
	return `(min-width: ${WIDE_FROM}rem) ${wide}, (min-width: 60rem) ${narrow}, calc(100vw - ${GUTTER_REM}rem)`;
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
