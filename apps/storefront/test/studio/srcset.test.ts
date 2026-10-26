import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { IMAGE_SIZES, readSrcSet } from "../../src/studio/srcset.ts";

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

describe("IMAGE_SIZES mirror styles.css (TAT-112)", () => {
	test("each slot's width is the one the stylesheet draws it at", () => {
		const rules = [
			".page { width: min(72rem, 100% - 2.5rem);",
			".profile-logo { display: block; inline-size: auto; max-inline-size: min(12rem, 100%);",
			".site-bar-logo { display: block; inline-size: auto; max-inline-size: 6rem;",
			".artist { display: grid; grid-template-columns: 7rem minmax(0, 1fr);",
			".artist-profile .artist-photo { max-width: 20rem; }",
			".deposit-logo { display: block; inline-size: auto; max-inline-size: 8rem;",
		];
		for (const rule of rules) {
			assert.ok(css.includes(rule), `styles.css lost: ${rule}`);
		}
		const wide = css.indexOf("@media (min-width: 48rem) {");
		assert.ok(wide > 0, "no 48rem media block");
		assert.ok(
			css
				.slice(wide, wide + 400)
				.includes(".artist { grid-template-columns: 9rem minmax(0, 1fr); }"),
			"the roster photo column is no longer 9rem from 48rem",
		);
	});

	test("the sizes strings", () => {
		assert.deepEqual(IMAGE_SIZES, {
			rosterPhoto: "(min-width: 48rem) 9rem, 7rem",
			profilePhoto: "20rem",
			cover: "(min-width: 74.5rem) 72rem, calc(100vw - 2.5rem)",
			profileLogo: "12rem",
			siteBarLogo: "6rem",
			depositLogo: "8rem",
		});
	});
});
