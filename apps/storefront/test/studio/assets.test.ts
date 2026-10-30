import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = new URL("../../src/", import.meta.url);

/** Local files named by url(...) in the stylesheet, relative to src/. */
function stylesheetFiles(css: string): string[] {
	return Array.from(css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g))
		.map((match) => match[1])
		.filter((href) => !/^(data:|https?:|\/\/)/.test(href));
}

describe("the stylesheet's files", () => {
	const css = readFileSync(new URL("styles.css", SRC), "utf8");

	test("every url() names a file that exists (a missing font would 404 on every page)", () => {
		for (const href of stylesheetFiles(css)) {
			assert.ok(
				existsSync(new URL(href, SRC)),
				`styles.css points at ${href}, which isn't in src/`,
			);
		}
	});

	test("loads nothing from another origin", () => {
		assert.doesNotMatch(css, /@import\s+(url\()?['"]?(https?:)?\/\//);
		assert.doesNotMatch(css, /url\(\s*['"]?(https?:)?\/\//);
	});

	test("every font stack ends in a generic family", () => {
		const faces = Array.from(
			css.matchAll(/--(?:body|display)-face:\s*([^;]+);/g),
			(match) => match[1],
		);
		assert.equal(faces.length, 2);
		for (const face of faces) {
			assert.match(face.trim(), /(?:^|,\s*)(?:serif|sans-serif)$/, face);
		}
	});

	test("the display stack names Eczar, then Devanagari-capable serifs", () => {
		const display = /--display-face:\s*([^;]+);/.exec(css)?.[1] ?? "";
		assert.match(display, /^Eczar, 'Noto Serif Devanagari', 'Noto Serif', /);
	});
});

/** The declarations of the rule whose selector list holds `selector` (among others, if it shares them). */
function ruleWith(css: string, selector: string): string {
	const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
	for (const match of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const own = match[1].split(/[;}]/).pop() ?? "";
		if (own.split(",").some((part) => part.trim() === selector))
			return match[2];
	}
	return "";
}

/** The declarations of the rule whose selector list is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
	const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
	for (const match of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		// `.pop()` drops a statement before the selector (`@import ...;`, `@custom-variant ...;`).
		const own = match[1].split(/[;}]/).pop()?.trim();
		if (own === selector) return match[2];
	}
	return "";
}

describe("text the studio typed", () => {
	const css = readFileSync(new URL("styles.css", SRC), "utf8");

	// A long name, a long host name or an unbroken string has no space to wrap
	// at: without `overflow-wrap: anywhere` it widens the page past 375 px.
	test("every element that holds it can wrap anywhere (a long link label can't widen the page)", () => {
		for (const selector of [
			"h1, h2, h3",
			".user-text",
			// The studio's name sits in the booking steps' lines (TAT-105), and the
			// location line holds the address (a backstop to locationLine's cap).
			".step-title",
			".step-detail",
			".profile-location",
			// The form's legends and hints and notes name the studio too.
			".intake legend, .intake p",
			".site-footer",
			".action",
			".link-chip",
			// The Request button is an .action, listed above; a long Devanagari
			// studio name wraps in the way home (TAT-127).
			".site-bar-home",
		]) {
			assert.match(
				ruleBody(css, selector),
				/overflow-wrap:\s*anywhere/,
				selector,
			);
		}
	});
});

describe("a studio's cover image (TAT-54)", () => {
	const css = readFileSync(new URL("styles.css", SRC), "utf8");

	// object-fit: cover crops the middle of a portrait photo, which is a
	// mid-body slice with the head cut off; a crop biased toward the top keeps
	// a face in the frame, and a landscape photo (which only loses its top and
	// bottom edges) barely moves.
	test("crops toward the top, so a portrait photo keeps its head", () => {
		const body = ruleBody(css, ".profile-cover > img");
		assert.match(body, /object-fit:\s*cover/);
		assert.match(body, /object-position:\s*50%\s+25%/);
	});
});

describe("route imports of built assets", () => {
	test("every ?url import in src/ names a file that exists", () => {
		const files = readdirSync(SRC, { recursive: true })
			.map(String)
			.filter((file) => /\.(ts|tsx)$/.test(file));
		for (const file of files) {
			const text = readFileSync(new URL(file, SRC), "utf8");
			for (const match of text.matchAll(/from\s+["']([^"']+)\?url["']/g)) {
				const target = new URL(match[1], new URL(file, SRC));
				assert.ok(
					existsSync(fileURLToPath(target)),
					`${file} imports ${match[1]}?url, which doesn't exist`,
				);
			}
		}
	});
});

describe("the vendored Eczar files", () => {
	const css = readFileSync(new URL("styles.css", SRC), "utf8");
	const root = readFileSync(new URL("routes/__root.tsx", SRC), "utf8");
	const SUBSETS = ["latin", "latin-ext", "devanagari"] as const;
	const faces = Array.from(
		css.matchAll(/@font-face\s*\{([^}]*)\}/g),
		(m) => m[1],
	);

	test("three @font-face blocks, one per subset, bold, font-display: optional", () => {
		assert.equal(faces.length, SUBSETS.length);
		for (const subset of SUBSETS) {
			const block = faces.find((face) =>
				face.includes(`eczar-${subset}-700-normal.woff2`),
			);
			assert.ok(block, `no @font-face for the ${subset} subset`);
			assert.match(block, /font-family:\s*'Eczar'/);
			assert.match(block, /font-weight:\s*700/);
			assert.match(block, /font-display:\s*optional/);
			assert.match(block, /format\('woff2'\)/);
			assert.match(block, /unicode-range:\s*U\+/);
		}
	});

	test("each subset covers its own characters", () => {
		const range = (subset: string) =>
			faces.find((face) => face.includes(`eczar-${subset}-700-normal`)) ?? "";
		assert.match(range("devanagari"), /U\+0900-097F/);
		assert.match(range("latin"), /U\+0000-00FF/);
		assert.match(range("latin-ext"), /U\+0100-02BA/);
	});

	test("every file exists, is a woff2 and is small", () => {
		for (const subset of SUBSETS) {
			const file = new URL(
				`assets/fonts/eczar/eczar-${subset}-700-normal.woff2`,
				SRC,
			);
			assert.ok(existsSync(file), `${subset} file is missing`);
			const bytes = readFileSync(file);
			assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", subset);
			assert.ok(
				bytes.length < 150 * 1024,
				`${subset} is ${bytes.length} bytes`,
			);
		}
	});

	test("the SIL Open Font License sits next to the files", () => {
		const licence = readFileSync(
			new URL("assets/fonts/eczar/OFL.txt", SRC),
			"utf8",
		);
		assert.match(licence, /SIL OPEN FONT LICENSE Version 1\.1/i);
		assert.match(licence, /Eczar Project Authors/);
	});

	test("only the Latin file is preloaded, as a CORS-anonymous font", () => {
		const preloads = Array.from(root.matchAll(/rel:\s*"preload"/g));
		assert.equal(preloads.length, 1);
		assert.match(
			root,
			/import eczarLatin from "\.\.\/assets\/fonts\/eczar\/eczar-latin-700-normal\.woff2\?url"/,
		);
		assert.match(root, /href:\s*eczarLatin/);
		assert.match(root, /as:\s*"font"/);
		assert.match(root, /type:\s*"font\/woff2"/);
		assert.match(root, /crossOrigin:\s*"anonymous"/);
		assert.doesNotMatch(root, /eczar-(latin-ext|devanagari)/);
	});
});

describe("the booking steps' two layouts (TAT-105)", () => {
	const css = readFileSync(new URL("styles.css", SRC), "utf8");
	const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

	// The page holds the four steps twice: the phone's strip and the desktop's
	// sticky panel. Each is display: none where it doesn't apply, so a screen
	// reader reads them once and no layout shows both.
	test("the strip shows below 60rem and the panel from it, never both", () => {
		assert.match(ruleBody(css, ".steps-strip"), /display:\s*grid/);
		assert.match(ruleBody(css, ".inquiry-aside"), /display:\s*none/);
		const wide = bare.slice(bare.indexOf("@media (min-width: 60rem)"));
		assert.match(wide, /\.steps-strip\s*\{\s*display:\s*none/);
		assert.match(wide, /\.inquiry-aside\s*\{[^}]*display:\s*grid/);
		assert.match(wide, /\.inquiry-aside\s*\{[^}]*position:\s*sticky/);
	});

	// "Prefer to chat?" is in the panel from 60rem and at the form's foot below
	// it, never both (the panel carries the same links).
	test("the form's foot 'Prefer to chat?' is hidden beside the panel, from 60rem", () => {
		const wide = bare.slice(bare.indexOf("@media (min-width: 60rem)"));
		assert.match(wide, /\.inquiry-split \.intake-chat\s*\{\s*display:\s*none/);
		assert.doesNotMatch(ruleBody(css, ".intake-chat"), /display:\s*none/);
	});

	test("the location line has a backstop width", () => {
		assert.match(
			ruleBody(css, ".profile-location"),
			/max-inline-size:\s*36rem/,
		);
	});
});

describe("the header and the chat button (TAT-127)", () => {
	const css = readFileSync(new URL("styles.css", SRC), "utf8");
	const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const wide = bare.slice(bare.indexOf("@media (min-width: 60rem)"));

	test("the bar sticks to the top over the content", () => {
		const body = ruleBody(css, ".site-bar");
		assert.match(body, /position:\s*sticky/);
		assert.match(body, /inset-block-start:\s*0\b/);
		assert.match(body, /z-index:\s*1\b/);
		assert.match(body, /background:\s*var\(--paper\)/);
		assert.match(ruleBody(css, ":root"), /--site-bar-height:\s*3\.75rem/);
		assert.match(
			ruleBody(css, ".site-bar-inner"),
			/min-block-size:\s*var\(--site-bar-height\)/,
		);
	});

	// The height is one token for the scroll padding, the bar and the sticky
	// panel; the dark block changes colours only.
	test("--site-bar-height is defined once, on :root and not in the dark block", () => {
		const defs = [...bare.matchAll(/--site-bar-height:/g)];
		const dark = bare.indexOf("@media (prefers-color-scheme: dark) {");
		assert.equal(defs.length, 1);
		assert.ok(dark > 0);
		assert.ok((defs[0].index ?? Number.POSITIVE_INFINITY) < dark);
	});

	// --site-bar-height is the bar's one-line minimum; the bar grows to two
	// lines (a wrapped name, about 4.75rem) and no further, because both names
	// are clamped to two lines (below). The padding adds 2.5rem to the one-line
	// height, which leaves 1.5rem clear under a two-line bar.
	test("an anchor or a focused control is never hidden under the bar or the chat button", () => {
		assert.match(
			ruleBody(css, ":root:has(.site-bar)"),
			/scroll-padding-block-start:\s*calc\(var\(--site-bar-height\) \+ 2\.5rem\)/,
		);
		// The toggle sits above the device's bottom inset (max(1rem, inset)), so the clearances add it.
		assert.match(
			ruleBody(css, ":root:has(.chat-float)"),
			/scroll-padding-block-end:\s*calc\(5\.5rem \+ env\(safe-area-inset-bottom, 0px\)\)/,
		);
		assert.match(
			ruleBody(css, ":root:has(.chat-float) .site-footer"),
			/padding-block-end:\s*calc\(6rem \+ env\(safe-area-inset-bottom, 0px\)\)/,
		);
		assert.match(
			wide,
			/\.inquiry-aside\s*\{[^}]*inset-block-start:\s*calc\(var\(--site-bar-height\) \+ 1\.5rem\)/,
		);
	});

	// An old `/artists/<slug>#inquiry` link lands on the open artist's request
	// row (render.test.ts pins its class), which is neither a .section nor the
	// .inquiry section: the root's scroll padding clears it for any target, and
	// it gets the same extra room the other two have.
	test("every #inquiry landing place has room under the bar", () => {
		for (const selector of [".section", ".inquiry", ".artist-request"]) {
			assert.match(
				ruleBody(css, selector),
				/scroll-margin-block-start:\s*1\.5rem/,
				selector,
			);
		}
	});

	test("the chat button floats in the corner above the bar's layer, with a 48 px toggle and no marker", () => {
		const float = ruleBody(css, ".chat-float");
		assert.match(float, /position:\s*fixed/);
		assert.match(float, /z-index:\s*2\b/);
		assert.match(float, /inset-block-end:[^;]*env\(safe-area-inset-bottom/);
		assert.match(float, /inset-inline-end:\s*1rem/);
		// .action is 3rem tall; the toggle adds nothing that shrinks it.
		assert.match(ruleBody(css, ".action"), /min-height:\s*3rem/);
		assert.match(ruleBody(css, ".chat-float-toggle"), /list-style:\s*none/);
		assert.match(
			ruleBody(css, ".chat-float-toggle::-webkit-details-marker"),
			/display:\s*none/,
		);
		const links = ruleBody(css, ".chat-float-links");
		assert.match(links, /position:\s*absolute/);
		assert.match(links, /inset-block-end:\s*calc\(100% \+ 0\.5rem\)/);
		assert.match(links, /background:\s*var\(--paper\)/);
		assert.match(links, /border:[^;]*var\(--line-strong\)/);
	});

	// The bar's height is the scroll padding's arithmetic: a name that wrapped
	// to three lines or more would put focus targets under it, so the artist's
	// name in the Request button and the studio's own name stop at two lines.
	const CLAMP = [
		/display:\s*-webkit-box/,
		/-webkit-box-orient:\s*vertical/,
		/-webkit-line-clamp:\s*2\b/,
		/(?<!-webkit-)line-clamp:\s*2\b/,
		/overflow:\s*hidden/,
	];

	test("the Request button's text stops at two lines, so the bar is never taller than the scroll padding allows", () => {
		const body = ruleWith(css, ".site-bar-request > span");
		for (const pattern of CLAMP) assert.match(body, pattern, String(pattern));
	});

	test("the studio's name in the bar stops at two lines too, with or without a logo", () => {
		// With a logo the name is a <span> beside the image; without one it is the link's own text.
		for (const selector of [
			".site-bar-home > span",
			".site-bar-home:not(:has(.site-bar-logo))",
		]) {
			const body = ruleWith(css, selector);
			for (const pattern of CLAMP) {
				assert.match(body, pattern, `${selector} ${pattern}`);
			}
		}
	});

	test("the bar's Request button shrinks and wraps inside the bar instead of widening the page", () => {
		const request = ruleBody(css, ".site-bar-request");
		assert.match(request, /flex:\s*0 1 auto/);
		assert.match(request, /max-inline-size:\s*60%/);
		assert.match(ruleBody(css, ".site-bar-home"), /min-inline-size:\s*0/);
		assert.match(ruleBody(css, ".site-bar-inner"), /display:\s*flex/);
	});

	test("the layers use the theme's tokens only, no colour of their own", () => {
		for (const selector of [
			".site-bar",
			".site-bar-inner",
			".site-bar-home",
			".site-bar-request",
			".chat-float",
			".chat-float-toggle",
			".chat-float-links",
		]) {
			assert.doesNotMatch(
				ruleBody(css, selector),
				/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i,
				selector,
			);
		}
	});
});

describe("Good to know and the cover's state line (TAT-128)", () => {
	const css = readFileSync(new URL("styles.css", SRC), "utf8");

	test("each summary is a 48 px, full-width row with no browser marker", () => {
		const summary = ruleBody(css, ".know-more > summary");
		assert.match(summary, /min-block-size:\s*3rem/);
		assert.match(summary, /list-style:\s*none/);
		assert.match(
			ruleBody(css, ".know-more > summary::-webkit-details-marker"),
			/display:\s*none/,
		);
	});

	test("the cover's line keeps its height while the browser fills it, and wraps anywhere", () => {
		const hours = ruleBody(css, ".profile-hours");
		assert.match(hours, /min-block-size:\s*1\.4em/);
		assert.match(hours, /overflow-wrap:\s*anywhere/);
		assert.match(
			ruleBody(css, ".profile-cover .profile-hours"),
			/color:\s*var\(--on-photo\)/,
		);
	});

	test("a line of hours or closed days is a label column and a text column, so a long note wraps under itself", () => {
		const line = ruleBody(css, ".know-lines li");
		assert.match(line, /display:\s*grid/);
		assert.match(line, /grid-template-columns:\s*7rem minmax\(0, 1fr\)/);
	});

	test("a studio's words in the list wrap instead of widening the page", () => {
		assert.match(ruleBody(css, ".know-item dd"), /overflow-wrap:\s*anywhere/);
		assert.match(ruleBody(css, ".know-item dd"), /min-inline-size:\s*0/);
	});
});
