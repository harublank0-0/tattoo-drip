import { safeImageUrl } from "./links.ts";

/** At most this many variants are read (the contract's maxItems). */
const MAX_VARIANTS = 8;
/** What ends a srcset candidate early, or has no place in a URL. */
const UNSAFE = /[\s\p{Cc},]/u;

function own(value: unknown, key: string): unknown {
	return typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.hasOwn(value, key)
		? (value as Record<string, unknown>)[key]
		: undefined;
}

/** The origin of an http(s) URL; undefined for anything else or a bad URL. */
function originOf(url: string): string | undefined {
	try {
		const { protocol, origin } = new URL(url);
		return protocol === "https:" || protocol === "http:" ? origin : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The `srcset` of an image (TAT-112): the API's `variants` (smaller copies,
 * `{ url, width }`) and the image's own `src` at `width`, narrowest first, or
 * undefined when no variant passes: the page then shows `src` alone, as it
 * did before. Pure. A variant is kept when its URL has no space, control
 * character or comma, passes safeImageUrl, and is on exactly `src`'s origin,
 * and its width is a whole number from 1 to below `width`; one variant per
 * width, the first. The page builds the string; the API never sends one.
 */
export function readSrcSet(
	variants: unknown,
	src: string,
	width: number,
): string | undefined {
	if (!Array.isArray(variants) || UNSAFE.test(src)) return undefined;
	const origin = originOf(src);
	if (origin === undefined) return undefined;
	const kept = new Map<number, string>();
	for (const item of variants.slice(0, MAX_VARIANTS)) {
		const url = own(item, "url");
		const candidateWidth = own(item, "width");
		if (typeof url !== "string" || UNSAFE.test(url)) continue;
		if (
			typeof candidateWidth !== "number" ||
			!Number.isInteger(candidateWidth) ||
			candidateWidth < 1 ||
			candidateWidth >= width ||
			kept.has(candidateWidth)
		) {
			continue;
		}
		const safe = safeImageUrl(url);
		if (safe === null || UNSAFE.test(safe) || originOf(safe) !== origin) {
			continue;
		}
		kept.set(candidateWidth, safe);
	}
	if (kept.size === 0) return undefined;
	const candidates = [...kept]
		.sort(([a], [b]) => a - b)
		.map(([candidateWidth, url]) => `${url} ${candidateWidth}w`);
	return [...candidates, `${src} ${width}w`].join(", ");
}

/** The widest copy the photo viewer shows (TAT-116). */
export const LARGE_WIDTH = 1280;

/**
 * What the photo viewer shows (TAT-116): the widest copy up to `max` px in the
 * image's checked `srcSet` (readSrcSet's string), else the image itself, which
 * is what an image no wider than `max`, or without copies, shows. Pure.
 */
export function largeSource(
	image: {
		readonly src: string;
		readonly width: number;
		readonly srcSet?: string;
	},
	max = LARGE_WIDTH,
): string {
	if (image.width <= max || !image.srcSet) return image.src;
	let best: { url: string; width: number } | null = null;
	for (const candidate of image.srcSet.split(", ")) {
		const [url, descriptor] = candidate.split(" ");
		const width = Number.parseInt(descriptor, 10);
		if (width <= max && (!best || width > best.width)) best = { url, width };
	}
	return best?.url ?? image.src;
}

/** What `sizes` needs of an image: its stored size (the page's own width and height). */
export interface ImageSize {
	readonly width: number;
	readonly height: number;
}

/**
 * The browser takes the smallest candidate at least as wide as `sizes` times
 * the device pixel ratio, so `sizes` must say how many CSS px of width the
 * drawn image needs, not only how wide its box is. styles.css fills a photo's
 * box with `object-fit: cover`, so a landscape photo in the portrait box is
 * enlarged until it is as tall as the box: it needs the box's width times
 * max(1, box height / box width x image width / image height). A logo is
 * contained in a box of fixed height, so it needs min(its max width, its
 * height x image width / image height). These are plain `rem` values (and
 * `calc` of `vw`), rounded up to a hundredth of a rem: a little more only
 * ever costs the next copy. test/studio/srcset.test.ts models the browser's
 * choice with the boxes read from styles.css.
 */

/** `.artist-photo` and `.profile-cover` keep this margin on their right: the image is that much narrower. */
const MARGIN_REM = 0.375;
/** `.artist-photo img`: aspect-ratio 4 / 5, so its height is this times its width. */
const PHOTO_RATIO = 5 / 4;
/** The photo columns: the roster's 7rem (9rem from 48rem) and the artist page's 20rem. */
const ROSTER_REM = { narrow: 7, wide: 9 };
const PROFILE_REM = 20;
/** The page is min(72rem, 100% - 2.5rem) wide; the cover is 4 / 3, and 21 / 9 from 60rem (TAT-116). */
const PAGE_REM = 72;
const PAGE_GUTTER_REM = 2.5;
const COVER_RATIO = 3 / 4;
const COVER_WIDE_RATIO = 9 / 21;
/** Where the cover turns wide (styles.css: `@media (min-width: 60rem)`). */
const COVER_WIDE_REM = 60;

/** The logos' boxes: `block-size` and `max-inline-size` in styles.css. */
export const LOGO_SLOTS = {
	/** `.profile-logo` above the studio's name. */
	hero: { maxRem: 12, heightRem: 4 },
	/** `.site-bar-logo` in the artist page's bar. */
	siteBar: { maxRem: 6, heightRem: 2 },
	/** `.deposit-logo` in the deposit page's header. */
	deposit: { maxRem: 8, heightRem: 2.75 },
} as const;
export type LogoSlot = keyof typeof LOGO_SLOTS;

/** Rounded up to a hundredth of a rem, after dropping floating point noise (6.625000000000001). */
function rem(value: number): string {
	return `${Math.ceil(Number((value * 100).toFixed(6))) / 100}rem`;
}

/** How much wider than its box an image is drawn when it covers a box `ratio` tall (height / width). */
function coverFactor(ratio: number, image: ImageSize): number {
	return Math.max(1, (ratio * image.width) / image.height);
}

/** A roster photo (`.artist-photo`): the 4:5 box of the photo column, 7rem wide, 9rem from 48rem. */
export function rosterPhotoSizes(image: ImageSize): string {
	const factor = coverFactor(PHOTO_RATIO, image);
	return `(min-width: 48rem) ${rem((ROSTER_REM.wide - MARGIN_REM) * factor)}, ${rem((ROSTER_REM.narrow - MARGIN_REM) * factor)}`;
}

/**
 * The width of the page's column less its margin, times `factor`: `calc` of
 * `vw`, a plain length when it is 1. `factor` is rounded up to a hundredth
 * (a thousandth with `fine`, for a third of a column).
 */
function viewportCalc(offsetRem: number, factor: number, fine = false): string {
	const scale = fine ? 1000 : 100;
	const rounded = Math.ceil(Number((factor * scale).toFixed(6))) / scale;
	const minus = `100vw - ${offsetRem}rem`;
	return rounded === 1 ? `calc(${minus})` : `calc((${minus}) * ${rounded})`;
}

/**
 * The artist page's photo: the 4:5 box of the 20rem column from 48rem; below
 * that the box is 20rem wide, or as wide as the page less the margin on a
 * phone narrower than 22.875rem (366 px).
 */
export function profilePhotoSizes(image: ImageSize): string {
	const factor = coverFactor(PHOTO_RATIO, image);
	const phone = viewportCalc(PAGE_GUTTER_REM + MARGIN_REM, factor);
	return `(min-width: 48rem) ${rem((PROFILE_REM - MARGIN_REM) * factor)}, (min-width: ${PROFILE_REM + PAGE_GUTTER_REM + MARGIN_REM}rem) ${rem(PROFILE_REM * factor)}, ${phone}`;
}

/**
 * The cover (`.profile-cover img`, TAT-116): the page's width less the
 * margin, in a box that is 4:3 below 60rem and 21:9 from it (no height
 * limit; a long name makes the real box taller, which only means a little
 * more enlargement than this asks for). A photo flatter than the box is
 * enlarged until it is as tall as the box, so it needs the box's width times
 * how much flatter the box is. From 74.5rem the page stops growing (72rem).
 */
export function coverSizes(image: ImageSize): string {
	const wideFactor = coverFactor(COVER_WIDE_RATIO, image);
	const narrow = viewportCalc(
		PAGE_GUTTER_REM + MARGIN_REM,
		coverFactor(COVER_RATIO, image),
	);
	const wide = viewportCalc(PAGE_GUTTER_REM + MARGIN_REM, wideFactor);
	return `(min-width: ${PAGE_REM + PAGE_GUTTER_REM}rem) ${rem((PAGE_REM - MARGIN_REM) * wideFactor)}, (min-width: ${COVER_WIDE_REM}rem) ${wide}, ${narrow}`;
}

/** `.work-strip`: the roster's thumbnails are squares of this many rem at every width (TAT-116). */
const WORK_STRIP_REM = 5;

/** A roster thumbnail of an artist's work (`.work-thumb`): a fixed 5rem square covered by the photo. */
export function workStripSizes(image: ImageSize): string {
	return rem(WORK_STRIP_REM * coverFactor(1, image));
}

/** `.work-grid`: three square columns, at most 48rem wide, with 0.5rem gaps (TAT-116). */
const WORK_GRID_MAX_REM = 48;
const WORK_GRID_GAP_REM = 0.5;

/**
 * A photo in the artist page's work grid (`.work-photo`): a square column,
 * a third of the grid less its gaps. The grid is the page's width (a phone:
 * 100vw less the page's gutter) up to 48rem, which the page reaches at
 * 50.5rem.
 */
export function workGridSizes(image: ImageSize): string {
	const factor = coverFactor(1, image);
	const column = (WORK_GRID_MAX_REM - 2 * WORK_GRID_GAP_REM) / 3;
	return `(min-width: ${WORK_GRID_MAX_REM + PAGE_GUTTER_REM}rem) ${rem(column * factor)}, ${viewportCalc(PAGE_GUTTER_REM + 2 * WORK_GRID_GAP_REM, factor / 3, true)}`;
}

/** A logo: as wide as its height allows, at most the slot's max width. */
export function logoSizes(image: ImageSize, slot: LogoSlot): string {
	const { maxRem, heightRem } = LOGO_SLOTS[slot];
	return rem(Math.min(maxRem, (heightRem * image.width) / image.height));
}
