import type { ImageSize } from "../../../srcset.ts";

/*
 * `sizes` for the directory's photos (artists.css's boxes): the CSS px of
 * width the browser must fetch to fill each box with `object-fit: cover`
 * (srcset.ts explains the cover factor). The page column is
 * min(72rem, 100vw - 2.5rem), reached at 74.5rem. Pure.
 */
const COLUMN_REM = 72;
const GUTTER_REM = 2.5;
const WIDE_FROM_REM = COLUMN_REM + GUTTER_REM;

function round(value: number): number {
	return Math.ceil(Number((value * 100).toFixed(6))) / 100;
}

/** How much wider than its box an image is drawn when it covers a box `ratio` (height / width) tall. */
function coverFactor(ratio: number, image: ImageSize): number {
	return Math.max(1, (ratio * image.width) / image.height);
}

/** `share` of the column at every width: a fixed rem once the column stops growing. */
function share(value: number, factor: number): [wide: string, narrow: string] {
	return [
		`${round(COLUMN_REM * value * factor)}rem`,
		`calc((100vw - ${GUTTER_REM}rem) * ${round(value * factor)})`,
	];
}

/**
 * A portrait in the grid (4:5): one column on a phone, two from 40rem, three
 * from 64rem (two when there are only two artists).
 */
export function portraitSizes(count: number, image: ImageSize): string {
	const factor = coverFactor(5 / 4, image);
	const columns = count === 2 ? 2 : 3;
	const [wide, desktop] = share(1 / columns, factor);
	const [, tablet] = share(1 / 2, factor);
	const [, phone] = share(1, factor);
	return `(min-width: ${WIDE_FROM_REM}rem) ${wide}, (min-width: 64rem) ${desktop}, (min-width: 40rem) ${tablet}, ${phone}`;
}

/** A lone artist's portrait (4:5): 5/12 of the column from 48rem, else the column. */
export function featurePortraitSizes(image: ImageSize): string {
	const factor = coverFactor(5 / 4, image);
	const [wide, desktop] = share(5 / 12, factor);
	const [, phone] = share(1, factor);
	return `(min-width: ${WIDE_FROM_REM}rem) ${wide}, (min-width: 48rem) ${desktop}, ${phone}`;
}

/** A card's work thumbnail: a 4.5rem square. */
export function thumbSizes(image: ImageSize): string {
	return `${round(4.5 * coverFactor(1, image))}rem`;
}

/** A lone artist's work preview: squares, three across the 7/12 column from 48rem, three across the column below. */
export function featureWorkSizes(image: ImageSize): string {
	const factor = coverFactor(1, image);
	const [wide, desktop] = share(7 / 12 / 3, factor);
	const [, phone] = share(1 / 3, factor);
	return `(min-width: ${WIDE_FROM_REM}rem) ${wide}, (min-width: 48rem) ${desktop}, ${phone}`;
}
