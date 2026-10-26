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

/**
 * Each image slot's `sizes`: the width it is drawn at, from styles.css
 * (test/studio/srcset.test.ts pins both sides). A wider guess only costs a
 * bigger copy; a narrower one a soft image.
 */
export const IMAGE_SIZES = {
	rosterPhoto: "(min-width: 48rem) 9rem, 7rem",
	profilePhoto: "20rem",
	cover: "(min-width: 74.5rem) 72rem, calc(100vw - 2.5rem)",
	profileLogo: "12rem",
	siteBarLogo: "6rem",
	depositLogo: "8rem",
} as const;
