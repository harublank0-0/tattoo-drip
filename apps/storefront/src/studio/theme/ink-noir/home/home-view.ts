import type { GalleryPhotoView } from "../../../gallery.ts";
import { workHref } from "../../../links.ts";
import type { StudioPageData } from "../../../loaders.ts";
import type { ImageSize } from "../../../srcset.ts";
import type {
	ArtistPhoto,
	ArtistView,
	WorkPhotoView,
} from "../../../view-model.ts";
import type { SectionKey } from "../../config.ts";

/**
 * What Ink Noir's home page shows, worked out from the studio page's data
 * (loadStudioPage: no read of its own). Pure. Every photo shown is the
 * studio's own. The large ones appear once each: the cover, else a large
 * enough portfolio photo, opens the page; the next ones are the featured
 * work; the one after that sits beside the introduction. (The styles index
 * reuses the newest photos as small previews.) Nothing here is invented: a
 * part without data is null or empty, and the component leaves it out.
 */

/** The featured work shows at most this many photos. */
export const FEATURED_COUNT = 6;
/** A portfolio photo stands in for a missing cover only when at least this wide. */
const HERO_MIN_WIDTH = 1200;
/** The styles index lists at most this many. */
const MAX_STYLES = 8;

/** A photo the page shows, with its stored size and its alt text. */
export interface HomePhoto extends ImageSize {
	readonly src: string;
	readonly srcSet?: string;
	readonly alt: string;
}

/** The first screen's photo: the studio's cover, or one of its portfolio photos. */
export interface HeroImage extends HomePhoto {
	readonly source: "cover" | "portfolio";
}

/** A style in the index: its gallery when photos carry it, the artists who list it. */
export interface StyleEntry {
	readonly name: string;
	/** `/gallery?style=<slug>` when a photo of the newest carries this style, else null. */
	readonly workHref: string | null;
	/** The newest photo carrying it, as its preview, or null. */
	readonly photo: GalleryPhotoView | null;
	readonly artists: readonly { readonly name: string; readonly href: string }[];
}

/** The home page's sections after the introduction, in the studio's order. */
export type HomeSection = SectionKey | "styles";

export interface InkNoirHome {
	readonly hero: HeroImage | null;
	/** The photos of the featured work, at most FEATURED_COUNT. */
	readonly featured: readonly GalleryPhotoView[];
	/** The photo beside the introduction: an unused work photo, else a lone artist's portrait the page doesn't show elsewhere. */
	readonly introPhoto: HomePhoto | null;
	readonly styles: readonly StyleEntry[];
	/** The sections to render after the hero and introduction, in order. */
	readonly sections: readonly HomeSection[];
}

export function inkNoirHome(data: StudioPageData): InkNoirHome {
	const shown = new Set(data.theme.sections);
	const recent = data.recentWork.photos;
	const hero = heroImage(data, recent);
	const heroSrc = hero?.source === "portfolio" ? hero.src : null;
	// The hero's photo is not repeated in the grid, unless it is the only one.
	const rest = recent.filter((photo) => photo.src !== heroSrc);
	const featured = (rest.length > 0 ? rest : recent).slice(0, FEATURED_COUNT);
	const used = new Set([heroSrc, ...featured.map((photo) => photo.src)]);
	const artists = shown.has("artists") ? data.artists : [];
	return {
		hero,
		featured,
		introPhoto: introPhoto(data, recent, used, shown.has("artists")),
		styles: styleEntries(recent, data.recentWork.styles, artists),
		sections: homeSections(data.theme.sections),
	};
}

/**
 * The cover when the studio has one; else its first portfolio photo at least
 * 1200 px wide (the newest work, then the artists' own work photos), so a
 * small photo is never stretched across the screen; else null, and the first
 * screen is set in type alone.
 */
function heroImage(
	data: StudioPageData,
	recent: readonly GalleryPhotoView[],
): HeroImage | null {
	const cover = data.theme.heroImage;
	if (cover) return { ...photoOf(cover, cover.alt), source: "cover" };
	const candidates: readonly WorkPhotoView[] = [
		...recent,
		...data.artists.flatMap((artist) => artist.workPhotos),
	];
	const large = candidates.find((photo) => photo.width >= HERO_MIN_WIDTH);
	return large ? { ...photoOf(large, large.alt), source: "portfolio" } : null;
}

/**
 * Beside the introduction: the first newest photo not already on the page;
 * else a lone artist's portrait (an independent artist is the studio), but
 * only while the artists section is hidden, since that section shows it large;
 * else null, and the introduction is text alone.
 */
function introPhoto(
	data: StudioPageData,
	recent: readonly GalleryPhotoView[],
	used: ReadonlySet<string | null>,
	artistsShown: boolean,
): HomePhoto | null {
	const unused = recent.find((photo) => !used.has(photo.src));
	if (unused) return photoOf(unused, unused.alt);
	const lone = data.artists.length === 1 ? data.artists[0] : null;
	return lone?.photo && !artistsShown ? portrait(lone.photo) : null;
}

function portrait(photo: ArtistPhoto): HomePhoto {
	return photoOf(photo, photo.alt);
}

function photoOf(
	image: ImageSize & { readonly src: string; readonly srcSet?: string },
	alt: string,
): HomePhoto {
	return {
		src: image.src,
		width: image.width,
		height: image.height,
		alt,
		...(image.srcSet ? { srcSet: image.srcSet } : {}),
	};
}

/**
 * The styles index: first the styles the newest photos carry (each with its
 * filtered gallery and the newest photo as its preview), then the ones only
 * the shown artists list; each with the artists who list it. Names match
 * without regard to case. At most eight; [] when nobody named a style.
 */
export function styleEntries(
	recent: readonly GalleryPhotoView[],
	galleryStyles: readonly { readonly slug: string; readonly name: string }[],
	artists: readonly ArtistView[],
): StyleEntry[] {
	const entries = new Map<
		string,
		{
			name: string;
			workHref: string | null;
			photo: GalleryPhotoView | null;
			artists: { name: string; href: string }[];
		}
	>();
	// Not toLocaleLowerCase: the server's and the browser's locales may differ.
	const key = (name: string) => name.toLowerCase();
	for (const style of galleryStyles) {
		if (entries.has(key(style.name))) continue;
		entries.set(key(style.name), {
			name: style.name,
			workHref: workHref({ style: style.slug }),
			photo:
				recent.find((photo) =>
					photo.styles.some((name) => key(name) === key(style.name)),
				) ?? null,
			artists: [],
		});
	}
	for (const artist of artists) {
		for (const name of artist.styles) {
			const entry = entries.get(key(name)) ?? {
				name,
				workHref: null,
				photo: null,
				artists: [],
			};
			if (!entry.artists.some((one) => one.href === artist.pageHref)) {
				entry.artists.push({ name: artist.name, href: artist.pageHref });
			}
			entries.set(key(name), entry);
		}
	}
	return [...entries.values()].slice(0, MAX_STYLES);
}

/**
 * The studio's sections in its own order (Page look), each as Ink Noir draws
 * it: `work` is the featured work, `artists` the artists, `info` the visit,
 * `inquiry` the closing invitation, `flash` the shared Flash section. The
 * styles index follows the later of `work` and `artists`, whose data it is
 * made of; with both hidden there is none.
 */
export function homeSections(sections: readonly SectionKey[]): HomeSection[] {
	const after = Math.max(sections.indexOf("work"), sections.indexOf("artists"));
	return sections.flatMap((section, index): HomeSection[] =>
		index === after ? [section, "styles"] : [section],
	);
}

/**
 * The featured work's mosaic, by how many photos there are: each photo's
 * columns and rows on the 12-column grid from 48rem, and on the 2-column
 * grid below it. The large photo leads; the rest fill rows exactly, so no
 * count leaves a hole.
 */
export interface Tile {
	readonly cols: number;
	readonly rows: number;
	readonly mobileCols: 1 | 2;
	readonly mobileRows: 1 | 2;
}

const WIDE: Record<number, readonly (readonly [number, number])[]> = {
	1: [[12, 2]],
	2: [
		[7, 2],
		[5, 2],
	],
	3: [
		[7, 2],
		[5, 1],
		[5, 1],
	],
	4: [
		[7, 1],
		[5, 1],
		[5, 1],
		[7, 1],
	],
	5: [
		[7, 2],
		[5, 1],
		[5, 1],
		[5, 1],
		[7, 1],
	],
	6: [
		[7, 2],
		[5, 1],
		[5, 1],
		[4, 1],
		[4, 1],
		[4, 1],
	],
};

export function featuredTiles(count: number): Tile[] {
	const wide = WIDE[Math.min(Math.max(count, 0), FEATURED_COUNT)] ?? [];
	// Below 48rem: the first photo spans both columns and two rows, the rest
	// sit in pairs, and a last one without a pair spans the row.
	const unpaired = (count - 1) % 2 === 1;
	return wide.map(([cols, rows], index) => {
		const lead = index === 0;
		const alone = !lead && unpaired && index === count - 1;
		return {
			cols,
			rows,
			mobileCols: lead || alone ? 2 : 1,
			mobileRows: lead ? 2 : 1,
		};
	});
}

/*
 * `sizes` for the page's photos: the CSS px of width the browser must fetch to
 * fill each box with `object-fit: cover` (see srcset.ts: a photo flatter than
 * its box is drawn wider than the box). The boxes are home.css's: the page
 * column is min(72rem, 100vw - 2.5rem), reached at 74.5rem.
 */
const COLUMN_REM = 72;
const GUTTER_REM = 2.5;
const WIDE_FROM_REM = COLUMN_REM + GUTTER_REM;
/** `.ink-work-grid` from 48rem: 12 columns, 0.75rem gaps, rows 20rem at the full column. */
const GRID_GAP_REM = 0.75;
const GRID_ROW_REM = 20;

/** Rounded up to a hundredth: a little more only ever costs the next copy. */
function round(value: number): number {
	return Math.ceil(Number((value * 100).toFixed(6))) / 100;
}

/** How much wider than its box an image is drawn when it covers a box `ratio` (height / width) tall. */
function coverFactor(ratio: number, image: ImageSize): number {
	return Math.max(1, (ratio * image.width) / image.height);
}

/** `share` of the page column, times `factor`, at every width. */
function columnSizes(share: number, factor: number, below = ""): string {
	const wide = `${round(COLUMN_REM * share * factor)}rem`;
	const narrow = `calc((100vw - ${GUTTER_REM}rem) * ${round(share * factor)})`;
	return below
		? `(min-width: ${WIDE_FROM_REM}rem) ${wide}, ${below.replace("NARROW", narrow)}`
		: `(min-width: ${WIDE_FROM_REM}rem) ${wide}, ${narrow}`;
}

/**
 * The first screen's photo: the full width of a phone (the hero is about 1.6
 * times as tall as it is wide there), and from 60rem the right 62% of the
 * screen, about 0.9 times as tall as it is wide on a laptop.
 */
export function heroSizes(image: ImageSize): string {
	const wide = round(0.62 * coverFactor(0.9, image));
	const narrow = round(coverFactor(1.6, image));
	return `(min-width: 60rem) calc(100vw * ${wide}), calc(100vw * ${narrow})`;
}

/** A featured photo in its tile (featuredTiles). */
export function featuredSizes(tile: Tile, image: ImageSize): string {
	const width = (tile.cols / 12) * COLUMN_REM;
	const height = tile.rows * GRID_ROW_REM + (tile.rows - 1) * GRID_GAP_REM;
	const wide = coverFactor(height / width, image);
	// Below 48rem the rows are as tall as a column is wide: a 1x1 tile is
	// square, the lead 2x2 is square, a lone 2x1 is twice as wide as tall.
	const mobileRatio = tile.mobileRows / tile.mobileCols;
	const narrow = round((tile.mobileCols / 2) * coverFactor(mobileRatio, image));
	return columnSizes(
		tile.cols / 12,
		wide,
		`(min-width: 48rem) NARROW, calc((100vw - ${GUTTER_REM}rem) * ${narrow})`,
	);
}

/**
 * A Fresh ink tile (Reviews and Fresh ink, slice 3; home.css `.ink-fresh-tile`:
 * 4:5, the photo covering it): a third of the column from 48rem, half of it
 * below, each times how much wider than the tile the photo is drawn.
 */
export function freshInkSizes(image: ImageSize): string {
	const factor = coverFactor(5 / 4, image);
	return columnSizes(
		1 / 3,
		factor,
		`(min-width: 48rem) NARROW, calc((100vw - ${GUTTER_REM}rem) * ${round(factor / 2)})`,
	);
}

/**
 * An artist's portrait (4:5): a lone artist's takes 5/12 of the column from
 * 48rem; among several, the column shares them out (two across from 36rem,
 * up to four from 60rem); below that each is the column's width.
 */
export function artistPortraitSizes(count: number, image: ImageSize): string {
	const factor = coverFactor(5 / 4, image);
	const full = `calc((100vw - ${GUTTER_REM}rem) * ${round(factor)})`;
	if (count === 1) {
		return columnSizes(5 / 12, factor, `(min-width: 48rem) NARROW, ${full}`);
	}
	const across = Math.min(count, 4);
	const half = `calc((100vw - ${GUTTER_REM}rem) * ${round(factor / 2)})`;
	return columnSizes(
		1 / across,
		factor,
		`(min-width: 60rem) NARROW, (min-width: 36rem) ${half}, ${full}`,
	);
}

/** The introduction's photo: 4:5 in 5/12 of the column from 60rem, else 4:3 across the column. */
export function introPhotoSizes(image: ImageSize): string {
	const below = round(coverFactor(3 / 4, image));
	return columnSizes(
		5 / 12,
		coverFactor(5 / 4, image),
		`(min-width: 60rem) NARROW, calc((100vw - ${GUTTER_REM}rem) * ${below})`,
	);
}

/** A style's preview: a square of 4.5rem, 7rem from 48rem. */
export function stylePreviewSizes(image: ImageSize): string {
	const factor = coverFactor(1, image);
	return `(min-width: 48rem) ${round(7 * factor)}rem, ${round(4.5 * factor)}rem`;
}
