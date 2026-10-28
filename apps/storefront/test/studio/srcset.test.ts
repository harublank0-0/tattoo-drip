import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	coverSizes,
	type LogoSlot,
	logoSizes,
	profilePhotoSizes,
	readSrcSet,
	rosterPhotoSizes,
} from "../../src/studio/srcset.ts";

/** The image's own URL; it is 1200 px wide in these tests. */
const S =
	"https://api.example.com/uploads/tenants/t/artist_photo/p.320-640.jpg";
const W = 1200;
const COPY = (width: number) =>
	`https://api.example.com/uploads/tenants/t/artist_photo/p.${width}w.jpg`;

describe("readSrcSet (TAT-112)", () => {
	test("nothing usable gives undefined", () => {
		for (const variants of [undefined, null, {}, "a 320w", [], 5, true]) {
			assert.equal(readSrcSet(variants, S, W), undefined, String(variants));
		}
	});

	test("builds the string itself, narrowest first, with the image last", () => {
		const out = readSrcSet(
			[
				{ url: COPY(640), width: 640 },
				{ url: COPY(320), width: 320 },
			],
			S,
			W,
		);

		assert.equal(out, `${COPY(320)} 320w, ${COPY(640)} 640w, ${S} ${W}w`);
	});

	test("one copy per width: the first of two entries wins", () => {
		const out = readSrcSet(
			[
				{ url: COPY(320), width: 320 },
				{ url: `${COPY(320)}?other=1`, width: 320 },
			],
			S,
			W,
		);

		assert.equal(out, `${COPY(320)} 320w, ${S} ${W}w`);
	});

	describe("drops a variant that", () => {
		const dropped: [string, unknown][] = [
			[
				"is on another origin",
				{ url: "https://evil.example/x.jpg", width: 320 },
			],
			[
				"is on another scheme",
				{ url: "http://api.example.com/x.jpg", width: 320 },
			],
			[
				"is on another port",
				{ url: "https://api.example.com:8443/x.jpg", width: 320 },
			],
			["is a javascript: URL", { url: "javascript:alert(1)", width: 320 }],
			["is a data: URL", { url: "data:image/png;base64,AAAA", width: 320 }],
			[
				"has credentials",
				{ url: "https://u:p@api.example.com/x.jpg", width: 320 },
			],
			["has a space", { url: "https://api.example.com/a b.jpg", width: 320 }],
			["has a tab", { url: "https://api.example.com/a\tb.jpg", width: 320 }],
			[
				"has a newline",
				{ url: "https://api.example.com/a\nb.jpg", width: 320 },
			],
			[
				"has a NUL",
				{ url: "https://api.example.com/a\u0000b.jpg", width: 320 },
			],
			["has a comma", { url: "https://api.example.com/a,b.jpg", width: 320 }],
			[
				"is 2049 characters long",
				{ url: `https://api.example.com/${"a".repeat(2049 - 24)}`, width: 320 },
			],
			["has width 0", { url: COPY(320), width: 0 }],
			["has a negative width", { url: COPY(320), width: -320 }],
			["has a fractional width", { url: COPY(320), width: 10.5 }],
			["has a string width", { url: COPY(320), width: "320" }],
			["is as wide as the image", { url: COPY(320), width: W }],
			["is wider than the image", { url: COPY(320), width: 1600 }],
			["is a string", COPY(320)],
			["is null", null],
			["is an array", [COPY(320), 320]],
			["has no url", { width: 320 }],
			[
				"has an inherited url and width",
				Object.create({ url: COPY(320), width: 320 }),
			],
		];

		for (const [name, item] of dropped) {
			test(name, () => {
				assert.equal(readSrcSet([item], S, W), undefined);
			});
		}
	});

	test("a hostile item next to a good one: only the good one is kept", () => {
		const out = readSrcSet(
			[
				{ url: "https://evil.example/x.jpg", width: 320 },
				{ url: COPY(640), width: 640 },
				{ url: "javascript:alert(1)", width: 480 },
				{ url: "https://api.example.com/a,b.jpg", width: 500 },
			],
			S,
			W,
		);

		assert.equal(out, `${COPY(640)} 640w, ${S} ${W}w`);
	});

	test("reads only the first 8 items", () => {
		const junk = Array.from({ length: 8 }, () => null);

		assert.equal(
			readSrcSet([...junk, { url: COPY(320), width: 320 }], S, W),
			undefined,
		);
		assert.equal(
			readSrcSet([...junk.slice(1), { url: COPY(320), width: 320 }], S, W),
			`${COPY(320)} 320w, ${S} ${W}w`,
		);
	});

	test("an image URL with a comma, a space or no real origin gives undefined", () => {
		const variants = [{ url: COPY(320), width: 320 }];

		assert.equal(
			readSrcSet(variants, "https://api.example.com/a,b.jpg", W),
			undefined,
		);
		assert.equal(
			readSrcSet(variants, "https://api.example.com/a b.jpg", W),
			undefined,
		);
		assert.equal(readSrcSet(variants, "not a url", W), undefined);
		assert.equal(readSrcSet(variants, "javascript:alert(1)", W), undefined);
		assert.equal(readSrcSet(variants, "", W), undefined);
	});
});

const css = readFileSync(
	new URL("../../src/styles.css", import.meta.url),
	"utf8",
);

/*
 * `sizes` follow the box each image is drawn in (TAT-112, fix round 1). The
 * browser takes the smallest candidate at least as wide as `sizes` x the
 * device pixel ratio, so `sizes` must say how many pixels the drawn image
 * needs: for a box filled with object-fit: cover that is the box's width times
 * max(1, box height / box width x image width / image height) (a landscape
 * photo in a portrait box is enlarged to fill its height); for a logo that is
 * contained in a box of fixed height it is min(its max width, its height x
 * the image's aspect). The tests below model the browser's choice and check
 * it against the stylesheet's own numbers.
 */

/** A number from the stylesheet: the first match of `pattern` in `text`. */
function number(
	text: string,
	pattern: RegExp,
	name: string,
	group = 1,
): number {
	const match = pattern.exec(text);
	assert.ok(match, `styles.css no longer has ${name}`);
	return Number(match[group]);
}

/** The text of the 48rem media block that holds the desktop layout. */
function wideBlock(): string {
	const at = css.indexOf("@media (min-width: 48rem) {");
	assert.ok(at > 0, "styles.css has no 48rem media block");
	return css.slice(at, at + 3000);
}

/** The drawn boxes, in rem, read from styles.css. */
const GEOMETRY = {
	pageMax: number(
		css,
		/\.page\s*\{\s*width:\s*min\(([\d.]+)rem,\s*100%\s*-\s*[\d.]+rem\)/,
		".page width",
	),
	pageGutter: number(
		css,
		/\.page\s*\{\s*width:\s*min\([\d.]+rem,\s*100%\s*-\s*([\d.]+)rem\)/,
		".page gutter",
	),
	breakpoint: number(
		css,
		/@media \(min-width:\s*([\d.]+)rem\)\s*\{\s*\.roster/,
		"the desktop breakpoint",
	),
	rosterNarrow: number(
		css,
		/\.artist\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*([\d.]+)rem/,
		"the roster photo column",
	),
	rosterWide: number(
		wideBlock(),
		/\.artist\s*\{\s*grid-template-columns:\s*([\d.]+)rem/,
		"the wide roster photo column",
	),
	photoMargin: number(
		css,
		/\.artist-photo\s*\{[^}]*margin:\s*0\s+([\d.]+)rem/,
		".artist-photo margin",
	),
	photoAspectWidth: number(
		css,
		/\.artist-photo img\s*\{[^}]*aspect-ratio:\s*(\d+)\s*\/\s*\d+/,
		"the photo aspect",
	),
	photoAspectHeight: number(
		css,
		/\.artist-photo img\s*\{[^}]*aspect-ratio:\s*\d+\s*\/\s*(\d+)/,
		"the photo aspect",
	),
	profileMax: number(
		css,
		/\.artist-profile \.artist-photo\s*\{\s*max-width:\s*([\d.]+)rem/,
		"the artist page photo width",
	),
	profileWide: number(
		wideBlock(),
		/\.artist-profile\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*([\d.]+)rem\)/,
		"the wide artist page column",
	),
	coverMargin: number(
		css,
		/\.profile-cover\s*\{[^}]*margin:\s*0\s+([\d.]+)rem/,
		".profile-cover margin",
	),
	coverAspectWidth: number(
		css,
		/\.profile-cover img\s*\{[^}]*aspect-ratio:\s*(\d+)\s*\/\s*\d+/,
		"the cover aspect",
	),
	coverAspectHeight: number(
		css,
		/\.profile-cover img\s*\{[^}]*aspect-ratio:\s*\d+\s*\/\s*(\d+)/,
		"the cover aspect",
	),
	coverMaxHeight: number(
		css,
		/\.profile-cover img\s*\{[^}]*max-block-size:\s*([\d.]+)rem/,
		"the cover's max height",
	),
	logo: {
		hero: {
			maxRem: number(
				css,
				/\.profile-logo\s*\{[^}]*max-inline-size:\s*min\(([\d.]+)rem/,
				".profile-logo max width",
			),
			heightRem: number(
				css,
				/\.profile-logo\s*\{[^}]*block-size:\s*([\d.]+)rem/,
				".profile-logo height",
			),
		},
		siteBar: {
			maxRem: number(
				css,
				/\.site-bar-logo\s*\{[^}]*max-inline-size:\s*([\d.]+)rem/,
				".site-bar-logo max width",
			),
			heightRem: number(
				css,
				/\.site-bar-logo\s*\{[^}]*block-size:\s*([\d.]+)rem/,
				".site-bar-logo height",
			),
		},
		deposit: {
			maxRem: number(
				css,
				/\.deposit-logo\s*\{[^}]*max-inline-size:\s*([\d.]+)rem/,
				".deposit-logo max width",
			),
			heightRem: number(
				css,
				/\.deposit-logo\s*\{[^}]*block-size:\s*([\d.]+)rem/,
				".deposit-logo height",
			),
		},
	},
};

const PX = 16;
const COPIES = [320, 640, 1280];

interface Size {
	width: number;
	height: number;
}
/** A drawn box in CSS px; `contain` is a logo (shown whole), else the image covers the box. */
interface Box {
	width: number;
	height: number;
	fit: "cover" | "contain";
}

/** The candidate widths the page gives the browser: the copies below the image, then the image. */
const candidatesOf = (image: Size) => [
	...COPIES.filter((width) => width < image.width),
	image.width,
];

/** The browser's pick: the smallest candidate at least `need` px wide, else the widest. */
function pick(candidates: number[], need: number): number {
	return (
		candidates.find((width) => width >= need) ?? (candidates.at(-1) as number)
	);
}

/** `sizes` evaluated at a viewport: the first entry whose media condition holds, in CSS px. */
function sizeAt(sizes: string, viewport: number): number {
	const entries = sizes.split(/,\s*(?![^(]*\))/);
	for (const entry of entries) {
		const media = /^\(min-width:\s*([\d.]+)rem\)\s+(.*)$/.exec(entry);
		if (media && viewport < Number(media[1]) * PX) continue;
		const value = media ? media[2] : entry;
		const plain = /^([\d.]+)rem$/.exec(value);
		if (plain) return Number(plain[1]) * PX;
		const calc =
			/^calc\(\(?100vw\s*-\s*([\d.]+)rem\)?(?:\s*\*\s*([\d.]+))?\)$/.exec(
				value,
			);
		if (calc) return (viewport - Number(calc[1]) * PX) * Number(calc[2] ?? 1);
		assert.fail(`unreadable sizes entry: ${entry}`);
	}
	return assert.fail(`no sizes entry holds at ${viewport}px: ${sizes}`);
}

/** CSS px the candidate must be shown at, per candidate pixel, times the device pixel ratio: above 1 it is enlarged. */
function enlargement(
	box: Box,
	image: Size,
	candidate: number,
	dpr: number,
): number {
	const height = (candidate * image.height) / image.width;
	const scale =
		box.fit === "cover"
			? Math.max(box.width / candidate, box.height / height)
			: Math.min(box.width / candidate, box.height / height);
	return scale * dpr;
}

const G = GEOMETRY;
const pageWidth = (viewport: number) =>
	Math.min(G.pageMax * PX, viewport - G.pageGutter * PX);
const photoRatio = G.photoAspectHeight / G.photoAspectWidth;
const wide = (viewport: number) => viewport >= G.breakpoint * PX;

interface Slot {
	name: string;
	sizes: (image: Size) => string;
	box: (viewport: number, image: Size) => Box;
}

const SLOTS: Slot[] = [
	{
		name: "roster photo",
		sizes: rosterPhotoSizes,
		box: (viewport) => {
			const width =
				((wide(viewport) ? G.rosterWide : G.rosterNarrow) - G.photoMargin) * PX;
			return { width, height: width * photoRatio, fit: "cover" };
		},
	},
	{
		name: "artist page photo",
		sizes: profilePhotoSizes,
		box: (viewport) => {
			const width = wide(viewport)
				? (G.profileWide - G.photoMargin) * PX
				: Math.min(G.profileMax * PX, pageWidth(viewport) - G.photoMargin * PX);
			return { width, height: width * photoRatio, fit: "cover" };
		},
	},
	{
		name: "cover",
		sizes: coverSizes,
		box: (viewport) => {
			const width = pageWidth(viewport) - G.coverMargin * PX;
			const height = Math.min(
				(width * G.coverAspectHeight) / G.coverAspectWidth,
				G.coverMaxHeight * PX,
			);
			return { width, height, fit: "cover" };
		},
	},
	...(["hero", "siteBar", "deposit"] as LogoSlot[]).map((slot) => ({
		name: `${slot} logo`,
		sizes: (image: Size) => logoSizes(image, slot),
		box: (_viewport: number, image: Size): Box => {
			const { maxRem, heightRem } = G.logo[slot];
			const height = heightRem * PX;
			return {
				width: Math.min(maxRem * PX, (height * image.width) / image.height),
				height,
				fit: "contain",
			};
		},
	})),
];

const IMAGES: [string, Size][] = [
	["landscape 4:3", { width: 2000, height: 1500 }],
	["portrait 3:4", { width: 1500, height: 2000 }],
	["a phone photo (3:4, 1638 x 2048)", { width: 1638, height: 2048 }],
	["square", { width: 1000, height: 1000 }],
	["panorama 10:1", { width: 2000, height: 200 }],
	["tall strip 1:10", { width: 200, height: 2000 }],
	["wide logo 3:1", { width: 600, height: 200 }],
	["just over a copy (330 px square)", { width: 330, height: 330 }],
	["just over two copies (700 x 400)", { width: 700, height: 400 }],
	["2048 px landscape", { width: 2048, height: 1536 }],
];

describe("sizes follow the box each image is drawn in (TAT-112)", () => {
	test("a landscape photo in the portrait box asks for the width its height needs", () => {
		// 2000 x 1500 in a 4:5 box is enlarged to 5/4 x 4/3 = 1.67 x the box's width.
		assert.equal(
			rosterPhotoSizes({ width: 2000, height: 1500 }),
			"(min-width: 48rem) 14.38rem, 11.05rem",
		);
		assert.equal(
			profilePhotoSizes({ width: 2000, height: 1500 }),
			"(min-width: 48rem) 32.71rem, (min-width: 22.875rem) 33.34rem, calc((100vw - 2.875rem) * 1.67)",
		);
		// A portrait photo fills the box's width: the box's own width.
		assert.equal(
			rosterPhotoSizes({ width: 1200, height: 1500 }),
			"(min-width: 48rem) 8.63rem, 6.63rem",
		);
		assert.equal(
			profilePhotoSizes({ width: 1200, height: 1500 }),
			"(min-width: 48rem) 19.63rem, (min-width: 22.875rem) 20rem, calc(100vw - 2.875rem)",
		);
	});

	test("a logo asks for min(its max width, its height x its aspect)", () => {
		const square = { width: 600, height: 600 };
		const three = { width: 600, height: 200 };
		assert.equal(logoSizes(square, "hero"), "4rem");
		assert.equal(logoSizes(square, "siteBar"), "2rem");
		assert.equal(logoSizes(square, "deposit"), "2.75rem");
		assert.equal(logoSizes(three, "hero"), "12rem");
		assert.equal(logoSizes(three, "siteBar"), "6rem");
		assert.equal(logoSizes(three, "deposit"), "8rem");
		assert.equal(logoSizes({ width: 2000, height: 200 }, "hero"), "12rem");
		assert.equal(logoSizes({ width: 200, height: 2000 }, "hero"), "0.4rem");
	});

	test("the cover keeps the page's width unless it is wider than its 3:1 box", () => {
		assert.equal(
			coverSizes({ width: 2048, height: 1024 }),
			"(min-width: 74.5rem) 71.63rem, calc(100vw - 2.875rem)",
		);
		assert.equal(
			coverSizes({ width: 2000, height: 500 }),
			"(min-width: 74.5rem) 71.63rem, calc((100vw - 2.875rem) * 1.34)",
		);
	});

	test("a float rounding error never adds a hundredth of a rem", () => {
		// 6.625 x 1.25 x (1200 / 1500) is 6.625000000000001 in floating point.
		assert.equal(
			rosterPhotoSizes({ width: 1200, height: 1500 }).endsWith("6.63rem"),
			true,
		);
		assert.equal(logoSizes({ width: 1200, height: 400 }, "hero"), "12rem");
	});

	for (const slot of SLOTS) {
		describe(slot.name, () => {
			for (const [name, image] of IMAGES) {
				test(`${name}: the browser picks the smallest candidate that is not enlarged`, () => {
					const candidates = candidatesOf(image);
					const sizes = slot.sizes(image);
					for (const viewport of [320, 375, 767, 768, 1024, 1280, 1600]) {
						for (const dpr of [1, 2, 3]) {
							const box = slot.box(viewport, image);
							const chosen = pick(candidates, sizeAt(sizes, viewport) * dpr);
							const where = `${slot.name}, ${name}, ${viewport}px at ${dpr}x, sizes="${sizes}", chose ${chosen}w of ${candidates.join("/")}`;
							const widest = chosen === candidates.at(-1);
							// Sharp: the chosen candidate is not enlarged, unless it is the image itself.
							if (!widest) {
								assert.ok(
									enlargement(box, image, chosen, dpr) <= 1 + 1e-9,
									`blurry: ${where}`,
								);
							}
							// Light: the next smaller candidate would be enlarged (allow 1% for the rounding up).
							const smaller = candidates
								.filter((width) => width < chosen)
								.at(-1);
							if (smaller !== undefined) {
								assert.ok(
									enlargement(box, image, smaller, dpr) > 0.99,
									`heavier than needed: ${where}`,
								);
							}
						}
					}
				});
			}
		});
	}

	test("styles.css still has the boxes these sizes are computed for", () => {
		// The numbers the helpers hard-code; a change here means the sizes need a second look.
		assert.deepEqual(
			[
				G.pageMax,
				G.pageGutter,
				G.breakpoint,
				G.rosterNarrow,
				G.rosterWide,
				G.photoMargin,
				G.photoAspectWidth,
				G.photoAspectHeight,
			],
			[72, 2.5, 48, 7, 9, 0.375, 4, 5],
		);
		assert.deepEqual(
			[
				G.profileMax,
				G.profileWide,
				G.coverMargin,
				G.coverAspectWidth,
				G.coverAspectHeight,
				G.coverMaxHeight,
			],
			[20, 20, 0.375, 3, 1, 16],
		);
		assert.deepEqual(G.logo, {
			hero: { maxRem: 12, heightRem: 4 },
			siteBar: { maxRem: 6, heightRem: 2 },
			deposit: { maxRem: 8, heightRem: 2.75 },
		});
	});
});
