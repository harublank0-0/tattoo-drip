import type { ImageSize } from "../../../srcset.ts";

/*
 * `sizes` for the artist page's photos (artist.css's boxes). The page column
 * is min(72rem, 100vw - 2.5rem), reached at 74.5rem. Pure.
 */
const COLUMN_REM = 72;
const GUTTER_REM = 2.5;
const WIDE_FROM_REM = COLUMN_REM + GUTTER_REM;

function round(value: number): number {
	return Math.ceil(Number((value * 100).toFixed(6))) / 100;
}

/**
 * The portrait (4:5, `object-fit: cover`): 5/12 of the column from 60rem, the
 * column below. A photo flatter than 4:5 is drawn wider than its box.
 */
export function portraitSizes(image: ImageSize): string {
	const factor = Math.max(1, (5 / 4) * (image.width / image.height));
	return `(min-width: ${WIDE_FROM_REM}rem) ${round(COLUMN_REM * (5 / 12) * factor)}rem, (min-width: 60rem) calc((100vw - ${GUTTER_REM}rem) * ${round((5 / 12) * factor)}), calc((100vw - ${GUTTER_REM}rem) * ${round(factor)})`;
}

/** The portfolio grid's gap between columns, in rem (artist.css). */
const GRID_GAP_REM = 0.75;

/**
 * A portfolio photo in its square cell: drawn whole (`object-fit: contain`,
 * never cropped), so it needs at most the cell's width. Three columns from
 * 48rem, two below.
 */
export function portfolioSizes(): string {
	const wide = (COLUMN_REM - 2 * GRID_GAP_REM) / 3;
	return `(min-width: ${WIDE_FROM_REM}rem) ${round(wide)}rem, (min-width: 48rem) calc((100vw - ${GUTTER_REM + 2 * GRID_GAP_REM}rem) / 3), calc((100vw - ${GUTTER_REM + GRID_GAP_REM}rem) / 2)`;
}
