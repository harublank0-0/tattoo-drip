import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { Artist, FlashPage, Studio } from "@tattoo-drip/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	connectServer,
	createApiContext,
	seedStudio,
} from "../../src/api/context.ts";
import { SiteRef } from "../../src/site/context.ts";
import { ErrorPage, NotFoundPage } from "../../src/studio/components/pages.tsx";
import {
	FLASH_WALL_COUNT,
	HOME_FLASH_COUNT,
	homeFlashCount,
} from "../../src/studio/flash.ts";
import {
	artistPageData,
	artistsPageData,
	artworkPageData,
	flashDesignPageData,
	flashPageData,
	infoPageData,
	loadRequestPage,
	loadStudioPage,
	requestPageData,
	studioPageData,
	workPageData,
} from "../../src/studio/loaders.ts";
import {
	accentTokens,
	brandingCss,
	challengeThemeFor,
	isSafeCss,
} from "../../src/studio/theme/branding.ts";
import { contrastRatio } from "../../src/studio/theme/color.ts";
import {
	FONT_KEYS,
	parseThemeConfig,
	THEME_KEYS,
	THEME_SECTIONS,
	type ThemeConfig,
	type ThemeKey,
} from "../../src/studio/theme/config.ts";
import { initialOf } from "../../src/studio/theme/flash-parlour/artist-index.tsx";
import { flashParlourHome } from "../../src/studio/theme/flash-parlour/home-view.ts";
import {
	flashSheetSizes,
	pieceSizes,
	SHEET_INSET_REM,
} from "../../src/studio/theme/flash-parlour/sizes.ts";
import {
	FLASH_PARLOUR_CLASS,
	FLASH_PARLOUR_SCHEME,
	FLASH_PARLOUR_THEME_COLOR,
} from "../../src/studio/theme/flash-parlour/theme.ts";
import {
	headingFontFile,
	matchedHeadingFont,
	matchedThemeKey,
	THEME_HTML,
} from "../../src/studio/theme/html.ts";
import {
	readPreviewTheme,
	THEME_NAMES,
} from "../../src/studio/theme/preview.ts";
import {
	THEMES,
	ThemedArtistPage,
	ThemedArtistsPage,
	ThemedArtworkPage,
	ThemedFlashDesignPage,
	ThemedFlashPage,
	ThemedInfoPage,
	ThemedRequestPage,
	ThemedStudioPage,
	ThemedWorkPage,
} from "../../src/studio/theme/registry.tsx";
import { fakeFetch, json } from "../tenancy/helpers.ts";
import {
	ARJUN,
	CLOSED_STUDIO,
	DEFAULT_STOREFRONT,
	EMPTY_FLASH_PAGE,
	EMPTY_STUDIO,
	flashId,
	flashPage,
	GOOD_TO_KNOW_STUDIO,
	galleryPage,
	ORIGIN,
	photoId,
	SITA,
	STUDIO,
	sitaWithWork,
} from "./fixtures.ts";
import { assertSafePage } from "./safety.ts";
import { COVER_SIZED, IMAGE_ORIGIN, withStorefront } from "./theme-fixtures.ts";

/**
 * Flash Parlour (src/studio/theme/flash-parlour/): a traditional walk-in
 * shop's wall of flash on cream. These pin that it is registered end to end
 * (key, sections, <html> class, scheme, theme colour, stylesheet, font and
 * its preload, the home page's twelve designs), that every colour reads where
 * it is used and a studio's accent is checked against its three surfaces,
 * and that each page renders the studio's own data in its frame: flash
 * first, never a made-up design, and every picture whole.
 */

const css = readFileSync(
	new URL("../../src/studio/theme/flash-parlour/styles.css", import.meta.url),
	"utf8",
);
const pagesCss = readFileSync(
	new URL("../../src/studio/theme/flash-parlour/pages.css", import.meta.url),
	"utf8",
);
const appCss = readFileSync(
	new URL("../../src/styles.css", import.meta.url),
	"utf8",
);
const bare = (sheet: string) => sheet.replace(/\/\*[\s\S]*?\*\//g, "");

function tokensOf(selector: string): Map<string, string> {
	const start = css.indexOf(`${selector} {`);
	assert.ok(start >= 0, selector);
	const body = css.slice(start, css.indexOf("}", start));
	return new Map(
		Array.from(body.matchAll(/(--[a-z-]+):\s*([^;]+);/g), (match) => [
			match[1],
			match[2].trim(),
		]),
	);
}

/** The declarations of the first rule whose selector list starts with `selector` (comments dropped). */
function ruleOf(sheet: string, selector: string): string {
	const body = `\n${bare(sheet)}`;
	const start = body.indexOf(`\n${selector} {`);
	assert.ok(start >= 0, selector);
	return body.slice(start, body.indexOf("}", start));
}

const parlour = (storefront: object = {}, studio: Studio = STUDIO): Studio =>
	withStorefront(
		{ ...DEFAULT_STOREFRONT, theme: "flash-parlour", ...storefront },
		studio,
	);

const mainOf = (html: string) => {
	const match = /<main[^>]*>([\s\S]*)<\/main>/.exec(html);
	assert.ok(match, "a <main>");
	return match[1];
};
const assertUniqueIds = (html: string) => {
	const all = Array.from(html.matchAll(/ id="([^"]*)"/g), (m) => m[1]);
	assert.deepEqual(
		all.filter((id, index) => all.indexOf(id) !== index),
		[],
		"ids are unique",
	);
};

function homeHtml(
	studio: Studio,
	artists: Artist[] = [SITA, ARJUN],
	work: unknown = null,
	flash: unknown = null,
) {
	return renderToStaticMarkup(
		createElement(ThemedStudioPage, {
			data: studioPageData(studio, artists, ORIGIN, IMAGE_ORIGIN, work, flash),
		}),
	);
}

/** A flash read whose designs are as `flashPage` makes them, each changed by `change`. */
function flashWith(
	count: number,
	change: (
		design: FlashPage["data"][number],
		index: number,
	) => FlashPage["data"][number],
	over: Partial<FlashPage> = {},
): FlashPage {
	const page = flashPage(count, over);
	return { ...page, data: page.data.map(change) };
}

const SURFACES = [
	FLASH_PARLOUR_SCHEME.paper,
	...(FLASH_PARLOUR_SCHEME.surfaces ?? []),
];

describe("Flash Parlour's palette (theme.ts and styles.css agree)", () => {
	const tokens = tokensOf(":root.theme-flash-parlour");
	const token = (name: string) => {
		const value = tokens.get(name);
		assert.ok(value, name);
		return value;
	};

	test("the scheme's cream, ink, muted ink, raised cream and sheet are the stylesheet's", () => {
		assert.equal(token("--paper"), FLASH_PARLOUR_SCHEME.paper);
		assert.equal(token("--ink"), FLASH_PARLOUR_SCHEME.ink);
		assert.equal(token("--ink-muted"), FLASH_PARLOUR_SCHEME.inkMuted);
		assert.deepEqual(FLASH_PARLOUR_SCHEME.surfaces, [
			token("--paper-raised"),
			token("--fp-sheet"),
		]);
		assert.equal(token("--on-stencil"), FLASH_PARLOUR_SCHEME.paper);
	});

	test("the red's tokens are what a studio's own accent would get here", () => {
		const accent = token("--stencil");
		assert.equal(accent, "#b02a1b");
		assert.equal(token("--fp-red"), accent);
		assert.deepEqual(accentTokens(accent, FLASH_PARLOUR_SCHEME), {
			stencil: accent,
			stencilStrong: token("--stencil-strong"),
			stencilWash: token("--stencil-wash"),
		});
	});

	test("every text colour reads at 4.5:1 on every surface, and control borders at 3:1", () => {
		for (const surface of SURFACES) {
			for (const name of [
				"--ink",
				"--ink-muted",
				"--stencil",
				"--stencil-strong",
				"--fp-green",
				"--fp-red",
				"--destructive",
			]) {
				assert.ok(
					contrastRatio(token(name), surface) >= 4.5,
					`${name} on ${surface}`,
				);
			}
			assert.ok(
				contrastRatio(token("--line-strong"), surface) >= 3,
				`--line-strong on ${surface}`,
			);
		}
		// Text on the fills: the cream on the red, the ink on the mustard.
		assert.ok(contrastRatio(token("--on-stencil"), token("--stencil")) >= 4.5);
		assert.ok(contrastRatio(token("--ink"), token("--fp-mustard")) >= 4.5);
		// The black footer: the cream and the mustard read on it, its focus ring too.
		assert.ok(contrastRatio(token("--paper"), token("--ink")) >= 4.5);
		assert.ok(contrastRatio(token("--fp-mustard"), token("--ink")) >= 4.5);
		// The red can't be the footer's button or ring: it is the mustard there.
		assert.ok(contrastRatio(token("--stencil"), token("--ink")) < 3);
		assert.match(
			css,
			/:root\.theme-flash-parlour \.fp-footer :focus-visible \{ outline-color: var\(--fp-mustard\); \}/,
		);
		assert.match(
			css,
			/:root\.theme-flash-parlour \.fp-footer \.fp-footer-cta \{ border-color: var\(--fp-mustard\); background: var\(--fp-mustard\); color: var\(--ink\);/,
		);
	});

	test("the mustard never carries text on the cream: only the black footer's words are in it", () => {
		assert.ok(contrastRatio(token("--fp-mustard"), token("--paper")) < 3);
		for (const sheet of [css, pagesCss]) {
			const body = bare(sheet);
			for (const match of body.matchAll(
				/([^{}]+)\{[^}]*(?:^|[\s;{])color:\s*var\(--fp-mustard(?:-deep)?\)/g,
			)) {
				for (const selector of match[1].split(",")) {
					assert.match(selector.trim(), /\.fp-footer/, selector.trim());
				}
			}
		}
	});

	test("display text asks for bold, with no faux bold: Shrikhand stays its one face, a fallback gets its real bold", () => {
		assert.match(css, /:root\.theme-flash-parlour \{ font-synthesis: none; \}/);
		assert.match(
			css,
			/:root\.theme-flash-parlour h1, :root\.theme-flash-parlour h2, :root\.theme-flash-parlour h3 \{ font-weight: 700; \}/,
		);
		// Only the @font-face blocks say 400; every rule in the display face asks for 700.
		const body = (sheet: string) =>
			bare(sheet).replace(/@font-face \{[^}]*\}/g, "");
		for (const sheet of [css, pagesCss]) {
			assert.doesNotMatch(body(sheet), /font-weight: 400/);
			for (const match of body(sheet).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
				if (/font-family: var\(--display-face\)/.test(match[2])) {
					assert.match(match[2], /font-weight: 700;/, match[1].trim());
				}
			}
		}
	});

	test("the chat button's focus ring reads where the button floats, over the cream and over the black footer, whatever the accent", () => {
		const rule = ruleOf(
			css,
			":root.theme-flash-parlour .chat-float :focus-visible",
		);
		const shadow =
			/box-shadow: 0 0 0 3px var\((--[a-z-]+)\), 0 0 0 6px var\((--[a-z-]+)\);/.exec(
				rule,
			);
		assert.ok(shadow, rule);
		const [inner, outer] = [token(shadow[1]), token(shadow[2])];
		// The places it floats over: every surface of the page, and the footer's black.
		const places = {
			cream: token("--paper"),
			raised: token("--paper-raised"),
			sheet: token("--fp-sheet"),
			footer: token("--ink"),
		};
		for (const [place, colour] of Object.entries(places)) {
			const best = Math.max(
				contrastRatio(inner, colour),
				contrastRatio(outer, colour),
			);
			assert.ok(best >= 3, `the ring on the ${place}: ${best.toFixed(2)}`);
		}
		// The two bands read against each other, and neither is the accent a studio can change.
		assert.ok(contrastRatio(inner, outer) >= 3);
		assert.doesNotMatch(rule, /--stencil/);
		const branded = brandingCss({
			...parseThemeConfig({ theme: "flash-parlour" }, null),
			accent: "#0f5e58",
		});
		assert.ok(branded);
		assert.doesNotMatch(branded, /--paper|--ink/);
		// A forced-colour device draws the outline it keeps.
		assert.match(rule, /outline: 3px solid transparent;/);
	});

	test("the tattoo's angles: the one shown marked by a heavier border and a mustard bar, the outline left to focus", () => {
		const current = ruleOf(
			pagesCss,
			'.fp-artwork-figure .artwork-angle[aria-current="true"]',
		);
		assert.match(current, /outline: none;/);
		assert.match(current, /border-width: 3px;/);
		assert.match(
			ruleOf(
				pagesCss,
				'.fp-artwork-figure .artwork-angle[aria-current="true"]::after',
			),
			/background: var\(--fp-mustard\);/,
		);
		const focus = ruleOf(
			pagesCss,
			".fp-artwork-figure .artwork-angle:focus-visible",
		);
		assert.match(focus, /outline: 3px solid var\(--stencil\);/);
		// Same specificity, later in the sheet: focus still draws its ring on the shown one.
		assert.ok(
			bare(pagesCss).indexOf(
				".fp-artwork-figure .artwork-angle:focus-visible {",
			) >
				bare(pagesCss).indexOf(
					'.fp-artwork-figure .artwork-angle[aria-current="true"] {',
				),
		);
	});

	test("one light scheme whatever the device prefers, its own font only, and imported", () => {
		assert.equal(css.match(/color-scheme:\s*light/g)?.length, 1);
		assert.doesNotMatch(css, /prefers-color-scheme/);
		assert.doesNotMatch(pagesCss, /url\(|@import/);
		assert.doesNotMatch(css, /@import/);
		const urls = Array.from(css.matchAll(/url\('([^']+)'\)/g), (m) => m[1]);
		assert.deepEqual(urls, [
			"../../../assets/fonts/shrikhand/shrikhand-latin-400-normal.woff2",
			"../../../assets/fonts/shrikhand/shrikhand-latin-ext-400-normal.woff2",
		]);
		assert.equal(css.match(/font-display: optional;/g)?.length, 2);
		assert.doesNotMatch(css, /font-display: (?!optional)/);
		for (const href of urls) {
			const bytes = readFileSync(
				new URL(
					`../../src/studio/theme/flash-parlour/${href}`,
					import.meta.url,
				),
			);
			assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", href);
			assert.ok(bytes.length < 24 * 1024, `${href} is ${bytes.length} bytes`);
		}
		assert.match(
			appCss,
			/@import '\.\/studio\/theme\/flash-parlour\/styles\.css';/,
		);
		assert.match(
			appCss,
			/@import '\.\/studio\/theme\/flash-parlour\/pages\.css';/,
		);
		// shadcn's `dark:` never applies under the light theme, even on a dark device.
		assert.match(
			appCss,
			/&:not\(:where\([^)]*\.theme-flash-parlour, \.theme-flash-parlour \*[^)]*\)\)/,
		);
	});

	test("Shrikhand is vendored with its licence and preloaded only while a Flash Parlour studio keeps the default font", () => {
		assert.match(
			token("--display-face"),
			/^'Shrikhand', 'Noto Serif Devanagari', 'Noto Serif', Georgia, 'Times New Roman', serif$/,
		);
		const licence = readFileSync(
			new URL("../../src/assets/fonts/shrikhand/OFL.txt", import.meta.url),
			"utf8",
		);
		assert.match(licence, /SIL Open Font License, Version 1\.1/);
		assert.match(licence, /Jonny Pinhorn/);
		const root = readFileSync(
			new URL("../../src/routes/__root.tsx", import.meta.url),
			"utf8",
		);
		assert.match(
			root,
			/import shrikhandLatin from "\.\.\/assets\/fonts\/shrikhand\/shrikhand-latin-400-normal\.woff2\?url";/,
		);
		assert.match(root, /shrikhand: shrikhandLatin,/);
		assert.match(root, /preloadedFont\(matchedHeadingFont\(matches\)\)/);
		// One preload, whichever face it is (assets.test.ts).
		assert.equal(root.match(/rel:\s*"preload"/g)?.length, 1);
	});

	test("the one preloaded heading font, for every theme and font: the theme's own face only with the default font", () => {
		const own: Record<ThemeKey, string> = {
			"stencil-and-ink": "eczar",
			"ink-noir": "eczar",
			irezumi: "eczar",
			atelier: "bodoni-moda",
			"flash-parlour": "shrikhand",
		};
		for (const theme of THEME_KEYS) {
			for (const font of FONT_KEYS) {
				assert.equal(
					headingFontFile(theme, font),
					font === "eczar" ? own[theme] : "eczar",
					`${theme} × ${font}`,
				);
			}
		}
		// From the router's matches: the root's studio decides, and /deposit is unthemed.
		const root = (font: string) => ({
			routeId: "__root__",
			loaderData: parlour({
				branding: { ...DEFAULT_STOREFRONT?.branding, font },
			}),
		});
		assert.equal(
			matchedHeadingFont([root("eczar"), { routeId: "/" }]),
			"shrikhand",
		);
		assert.equal(
			matchedHeadingFont([root("serif"), { routeId: "/" }]),
			"eczar",
		);
		assert.equal(
			matchedHeadingFont([root("eczar"), { routeId: "/deposit" }]),
			"eczar",
		);
		assert.equal(matchedHeadingFont([]), "eczar");
	});

	test("every rule is scoped: it starts at the theme's class or an fp- class", () => {
		const scoped =
			/^(:root\.theme-flash-parlour\b|:root:has\(\.chat-float\) \.fp-|\.fp-)/;
		for (const sheet of [css, pagesCss]) {
			const preludes = Array.from(bare(sheet).matchAll(/([^{};]+)\{/g), (m) =>
				m[1].trim(),
			);
			assert.ok(preludes.length > 50, "the rules were found");
			for (const prelude of preludes) {
				if (prelude.startsWith("@")) continue;
				for (const selector of prelude.split(",")) {
					assert.match(
						selector.trim(),
						scoped,
						`unscoped selector: ${selector.trim()}`,
					);
				}
			}
		}
	});

	test("tattoo photos and flash pictures are drawn whole and keep their space before they load", () => {
		for (const selector of [
			".fp-plate-photo",
			".fp-piece-photo",
			".fp-design-picture",
			".fp-artwork-figure .artwork-photo",
		]) {
			const rule = ruleOf(pagesCss, selector);
			assert.match(rule, /inline-size: 100%/, selector);
			assert.match(rule, /block-size: auto/, selector);
			assert.match(rule, /object-fit: contain/, selector);
		}
		// A flash sheet's cell is square and the picture is contained in it whole.
		assert.match(ruleOf(pagesCss, ".fp-card-sheet"), /aspect-ratio: 1/);
		assert.match(ruleOf(pagesCss, ".fp-card-picture"), /object-fit: contain/);
		// Only a portrait is cropped.
		assert.equal(
			bare(css + pagesCss).match(/object-fit: cover/g)?.length,
			2,
			"the artist's frame and the small portrait",
		);
	});

	test("nothing moves by itself: no animation, no transition", () => {
		assert.doesNotMatch(bare(pagesCss), /animation|transition:(?!\s*none)/);
		assert.doesNotMatch(bare(css), /@keyframes|transition:(?!\s*none)/);
		assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
	});

	test("where a device forces its own colours, the decoration steps back and the marks stay", () => {
		const forced = bare(css).slice(
			bare(css).indexOf("@media (forced-colors: active) {"),
		);
		assert.match(
			forced,
			/\.fp-star \{ fill: CanvasText; stroke: CanvasText; \}/,
		);
		assert.match(forced, /\.fp-ribbon-tail \{ display: none; \}/);
		assert.match(
			pagesCss,
			/\.fp-filter\[aria-current\] \{\s*border-width: 4px;/,
		);
	});
});

describe("Flash Parlour's registration", () => {
	test("its key, sections, <html> class, one light scheme, theme colour and preview name", () => {
		assert.ok((THEME_KEYS as readonly string[]).includes("flash-parlour"));
		assert.deepEqual(
			THEME_SECTIONS["flash-parlour"],
			THEME_SECTIONS["ink-noir"],
		);
		assert.equal(FLASH_PARLOUR_CLASS, "theme-flash-parlour");
		assert.deepEqual(THEME_HTML["flash-parlour"], {
			className: FLASH_PARLOUR_CLASS,
			scheme: FLASH_PARLOUR_SCHEME,
			themeColors: [{ content: FLASH_PARLOUR_THEME_COLOR }],
		});
		assert.equal(FLASH_PARLOUR_THEME_COLOR, "#f5ead3");
		assert.equal(THEME_NAMES["flash-parlour"], "Flash Parlour");
		assert.equal(readPreviewTheme("flash-parlour"), "flash-parlour");
		assert.equal(challengeThemeFor("flash-parlour"), "light");
	});

	test("the matched page is Flash Parlour for a studio that picked it, but never the deposit page", () => {
		const root = { routeId: "__root__", loaderData: parlour() };
		assert.equal(matchedThemeKey([root, { routeId: "/" }]), "flash-parlour");
		assert.equal(
			matchedThemeKey([root, { routeId: "/flash/$id" }]),
			"flash-parlour",
		);
		assert.equal(
			matchedThemeKey([root, { routeId: "/deposit" }]),
			"stencil-and-ink",
		);
	});

	test("its pages are its own, the flash pages included; the informational pages are the shared ones", () => {
		const theme = THEMES["flash-parlour"];
		assert.equal(theme.Shell.name, "FlashParlourShell");
		assert.equal(theme.StudioPage.name, "FlashParlourStudioPage");
		assert.equal(theme.ArtistsPage.name, "FlashParlourArtistsPage");
		assert.equal(theme.ArtistPage.name, "FlashParlourArtistPage");
		assert.equal(theme.WorkPage.name, "FlashParlourGalleryPage");
		assert.equal(theme.ArtworkPage.name, "FlashParlourArtworkPage");
		assert.equal(theme.FlashPage.name, "FlashParlourFlashPage");
		assert.equal(theme.FlashDesignPage.name, "FlashParlourFlashDesignPage");
		assert.equal(theme.RequestPage.name, "FlashParlourBookPage");
		assert.equal(theme.InfoPage, THEMES["stencil-and-ink"].InfoPage);
	});

	test("the home page reads twelve designs for its wall; every other theme still reads six", () => {
		assert.equal(FLASH_WALL_COUNT, 12);
		assert.equal(homeFlashCount("flash-parlour"), 12);
		for (const key of THEME_KEYS) {
			if (key !== "flash-parlour") {
				assert.equal(homeFlashCount(key), HOME_FLASH_COUNT, key);
			}
		}
	});

	test("loadStudioPage asks the API for twelve available designs on a Flash Parlour page, and six on any other", async () => {
		const API = "http://api.test";
		const urls = async (studio: Studio) => {
			const { calls, fetch } = fakeFetch(({ url }) => {
				if (url.endsWith("/artists")) return json(200, { data: [SITA] });
				if (url.includes("/work?")) return json(200, galleryPage(0));
				if (url.includes("/flash?")) return json(200, EMPTY_FLASH_PAGE);
				return json(404, { error: { code: "not_found", message: "x" } });
			});
			const api = createApiContext("server");
			connectServer(api, {
				config: { apiUrl: API, mediaUrl: API },
				studio,
				fetch,
			});
			seedStudio(api, studio);
			const site = new SiteRef();
			site.connect(ORIGIN);
			await loadStudioPage({ ...api, site });
			return calls
				.map((call) => call.url)
				.filter((url) => url.includes("/flash"));
		};
		const tenant = `${API}/api/v1/tenants/${STUDIO.slug}`;
		assert.deepEqual(await urls(parlour()), [
			`${tenant}/flash?available=true&limit=12`,
		]);
		assert.deepEqual(
			await urls(withStorefront({ ...DEFAULT_STOREFRONT, theme: "atelier" })),
			[`${tenant}/flash?available=true&limit=6`],
		);
		// A studio that hid Flash in Page look costs the API no flash read.
		assert.deepEqual(
			await urls(
				parlour({ sections: [{ type: "work" }, { type: "inquiry" }] }),
			),
			[],
		);
	});
});

describe("brandingCss for Flash Parlour: one light scheme, checked on all three surfaces", () => {
	const config = (values: Partial<ThemeConfig>): ThemeConfig => ({
		...parseThemeConfig({ theme: "flash-parlour" }, null),
		...values,
	});

	test("without a brand there is no <style>", () => {
		assert.equal(brandingCss(config({})), null);
	});

	test("an accent that reads on the cream, the raised cream and the sheet is set on the class, as it is", () => {
		const out = brandingCss(config({ accent: "#0f5e58" }));
		assert.ok(out);
		assert.ok(isSafeCss(out));
		assert.doesNotMatch(out, /@media/);
		assert.match(out, /^html:root\.theme-flash-parlour\{--stencil:#0f5e58;/);
	});

	test("an accent that reads on the cream but not on the raised cream keeps the red", () => {
		const paperOnly = "#0f766e";
		assert.ok(contrastRatio(paperOnly, FLASH_PARLOUR_SCHEME.paper) >= 4.5);
		assert.ok(
			contrastRatio(paperOnly, (FLASH_PARLOUR_SCHEME.surfaces ?? [])[0]) < 4.5,
		);
		assert.equal(brandingCss(config({ accent: paperOnly })), null);
	});

	test("the dark accent is not used: the page is never dark", () => {
		assert.equal(brandingCss(config({ accentDark: "#fca5a5" })), null);
	});

	test("Shrikhand is the theme's own face; the studio's own pick still wins, on the class", () => {
		assert.equal(brandingCss(config({ font: "eczar" })), null);
		assert.match(
			brandingCss(config({ font: "serif" })) ?? "",
			/html:root\.theme-flash-parlour\{--display-face:/,
		);
	});
});

describe("Flash Parlour's home page: flash leads", () => {
	const work = galleryPage(8);

	test("the shell: skip link, header with nav and booking, <main id=main>, the black footer", () => {
		const html = homeHtml(parlour(), [SITA, ARJUN], work, flashPage(3));
		assertSafePage(html);
		assertUniqueIds(html);
		assert.match(html, /<a class="fp-skip" href="#main">/);
		assert.match(html, /<header class="fp-header">/);
		assert.match(
			html,
			/<main id="main" tabindex="-1" class="fp-main fp-home">/,
		);
		assert.match(html, /<footer class="fp-footer">/);
		assert.match(html, /class="fp-menu-button"[^>]*aria-expanded="false"/);
		assert.match(html, /<a[^>]*aria-current="page"[^>]*>Home<\/a>/);
		assert.match(html, /href="\/flash"[^>]*>Flash<\/a>/);
		assert.doesNotMatch(html, /class="(site-bar|ink-header|atl-header)"/);
	});

	test("the page opens with the shop's slim sign (its name the first heading, the h1), then the wall of available designs", () => {
		const html = homeHtml(
			parlour({}, GOOD_TO_KNOW_STUDIO),
			[SITA, ARJUN],
			work,
			flashPage(14),
		);
		const main = mainOf(html);
		assert.match(
			main,
			/^<header class="fp-sign"><div class="fp-container fp-sign-inner"><div class="fp-sign-text"><p class="fp-kicker user-text" dir="auto">[^<]+<\/p><h1 class="fp-sign-name" dir="auto">Black Needle<\/h1>/,
		);
		// The first heading is the h1; the wall's ribbon follows as an h2, then the hours and booking come with the h1.
		const headings = Array.from(main.matchAll(/<h([1-3])[\s>]/g), (m) => m[1]);
		assert.deepEqual(headings.slice(0, 2), ["1", "2"]);
		const h1 = main.indexOf("<h1");
		const hours = main.indexOf('class="profile-hours"');
		const booking = main.indexOf('href="/book"');
		const wall = main.indexOf('<section id="flash" class="fp-wall"');
		assert.ok(
			h1 < hours && hours < booking && booking < wall,
			"name, hours, booking, then the wall",
		);
		assert.ok(
			wall > 0 && !main.slice(0, wall).includes("<img"),
			"nothing but the sign before the flash",
		);
		assert.match(
			html,
			/<h2 id="flash-title" class="fp-ribbon-title"><span class="fp-ribbon"><svg class="fp-ribbon-tail fp-ribbon-tail-start"[^>]*aria-hidden="true"/,
		);
		assert.match(html, />Flash on the wall</);
		// Twelve of the fourteen, newest first; the rest are a link away.
		assert.equal(html.match(/<li class="fp-card"/g)?.length, 12);
		assert.match(
			html,
			/<ul class="fp-flash-grid fp-flash-grid-wall" role="list">/,
		);
		assert.match(html, /href="\/flash">See all the flash</);
		assert.match(
			html,
			/<a class="action action-primary fp-cta" href="\/book">Request a session<\/a>/,
		);
		// No photo or second hero while the flash leads, and Flash isn't drawn twice.
		assert.doesNotMatch(html, /fp-hero-plate|class="fp-hero"/);
		assert.equal(html.match(/<h1/g)?.length, 1);
		assert.equal(html.match(/id="flash"/g)?.length, 1);
	});

	test("a sheet: the picture whole inside the design's link, its name, size and price, and the way to request it", () => {
		const html = homeHtml(parlour(), [SITA, ARJUN], null, flashPage(2));
		const first = /<li class="fp-card">([\s\S]*?)<\/li>/.exec(html)?.[1];
		assert.ok(first, "a sheet");
		assert.match(
			first,
			new RegExp(
				`^<a class="fp-card-link" href="/flash/${flashId(1)}"><span class="fp-card-sheet"><img class="fp-card-picture" src="[^"]*f1\\.320-640-1280\\.png"[^>]* width="1200" height="1200" alt="" loading="eager"`,
			),
		);
		assert.match(
			first,
			/<span class="fp-card-name user-text" dir="auto">Moth<\/span><\/a>/,
		);
		assert.match(
			first,
			/<p class="fp-card-facts"><span class="sr-only">Size: <\/span><span class="fp-card-size user-text" dir="auto">About 3 in<\/span><span class="sr-only"> Price: <\/span><span class="fp-card-price">NPR 3,000<\/span><\/p>/,
		);
		assert.match(first, /<p class="fp-card-by">by <bdi>Sita Rai<\/bdi><\/p>/);
		assert.match(
			first,
			new RegExp(
				`<a class="fp-card-request" href="/book\\?flash=${flashId(1)}"><span class="sr-only">Request this design: <bdi>Moth</bdi></span><span aria-hidden="true">Request this design</span></a>`,
			),
		);
		// A design without a price says to ask; never a made-up one.
		const second = html.split('<li class="fp-card">')[2];
		assert.match(
			second,
			/<span class="fp-card-price fp-card-price-ask">Ask for a price<\/span>/,
		);
		// The wall's sizes ask for its cells, six across from 80rem.
		assert.match(
			first,
			new RegExp(`sizes="${escapeRegExp(flashSheetSizes(true))}"`),
		);
		// The first six load at once (a phone shows six), the rest lazily.
		const many = homeHtml(parlour(), [SITA, ARJUN], null, flashPage(12));
		const loading = Array.from(
			many.matchAll(/<img class="fp-card-picture"[^>]* loading="(\w+)"/g),
			(m) => m[1],
		);
		assert.deepEqual(loading, [
			...Array(6).fill("eager"),
			...Array(6).fill("lazy"),
		]);
	});

	test("a sheet's sizes are the picture's own width: never smaller than drawn, never a column's worth more", () => {
		// The page's model (pages.css): the column, the wall's columns and gap,
		// and the sheet's insets around the picture.
		const REM = 16;
		const drawn = (viewport: number, wall: boolean) => {
			const column = Math.min(76 * REM, viewport - 2.5 * REM);
			const columns =
				wall && viewport >= 80 * REM
					? 6
					: viewport >= 60 * REM
						? 4
						: viewport >= 40 * REM
							? 3
							: 2;
			return (column - (columns - 1) * REM) / columns - SHEET_INSET_REM * REM;
		};
		for (const wall of [true, false]) {
			for (const viewport of [
				320, 375, 414, 640, 768, 1024, 1280, 1440, 1920,
			]) {
				const asked = evaluateSizes(flashSheetSizes(wall), viewport, REM);
				const real = drawn(viewport, wall);
				assert.ok(
					asked >= real - 0.5,
					`${viewport}: asks ${asked}, drawn ${real}`,
				);
				assert.ok(
					asked <= real * 1.05 + 1,
					`${viewport}: asks ${asked}, drawn ${real}`,
				);
			}
		}
		assert.equal(SHEET_INSET_REM, 2.625);
		// A 2x screen of 1280 px or more takes the 320 px copy for the wall.
		for (const viewport of [1280, 1440, 1920]) {
			assert.ok(evaluateSizes(flashSheetSizes(true), viewport, REM) * 2 <= 320);
		}
	});

	test("on a phone the wall shows its first six, the rest a link away", () => {
		assert.match(
			pagesCss,
			/@media \(max-width: 39\.99rem\) \{\s*\.fp-flash-grid-wall > \.fp-card:nth-child\(n \+ 7\) \{\s*display: none;/,
		);
	});

	test("a claimed design never pins up on the wall; one whose artist takes no flash says why and asks for nothing", () => {
		const flash = flashWith(3, (design, index) =>
			index === 0
				? { ...design, status: "claimed" as const, requestable: false }
				: index === 1
					? { ...design, requestable: false }
					: design,
		);
		const html = homeHtml(parlour(), [SITA, ARJUN], null, flash);
		assertSafePage(html);
		assert.equal(html.match(/<li class="fp-card/g)?.length, 2);
		assert.doesNotMatch(html, /Claimed|>Moth</);
		assert.match(
			html,
			/<li class="fp-card fp-card-closed">[\s\S]*?<p class="fp-card-note user-text" dir="auto">Not taking flash requests right now<\/p><\/li>/,
		);
		assert.equal(html.match(/class="fp-card-request"/g)?.length, 1);
	});

	test("no flash: the work leads (the largest piece, whole), and nothing is made up", () => {
		const html = homeHtml(parlour(), [SITA, ARJUN], work, EMPTY_FLASH_PAGE);
		assertSafePage(html);
		assert.doesNotMatch(html, /fp-wall|fp-card/);
		const lead = /<img class="fp-plate-photo"[^>]*>/.exec(html)?.[0];
		assert.ok(lead, "a lead photo");
		assert.match(lead, /loading="eager"/);
		assert.match(lead, /fetchPriority="high"/);
		assert.match(html, /<figure class="fp-plate fp-hero-plate">/);
		assert.match(html, />Fresh from the shop</);
		const data = studioPageData(
			parlour(),
			[SITA, ARJUN],
			ORIGIN,
			IMAGE_ORIGIN,
			work,
			EMPTY_FLASH_PAGE,
		);
		const home = flashParlourHome(data);
		assert.equal(home.wall.length, 0);
		assert.equal(home.lead?.source, "work");
		assert.ok(home.work.every((photo) => photo.src !== home.lead?.src));
		assert.equal(home.work.length, 6);
	});

	test("no flash and a cover: the cover leads", () => {
		const html = homeHtml(
			parlour({}, { ...STUDIO, cover: COVER_SIZED }),
			[SITA, ARJUN],
			work,
		);
		assertSafePage(html, { brandImages: true });
		assert.match(html, /<img class="fp-plate-photo"[^>]*cover\.jpg/);
		assert.doesNotMatch(html, /Fresh from the shop<\/figcaption>/);
	});

	test("Flash hidden in Page look: no wall, even with designs in hand", () => {
		const studio = parlour({
			sections: [{ type: "work" }, { type: "inquiry" }],
		});
		const html = homeHtml(studio, [SITA, ARJUN], work, flashPage(3));
		assert.doesNotMatch(html, /fp-wall|fp-card/);
	});

	test("the sections follow the studio's Page look order, and hidden ones are left out", () => {
		const html = homeHtml(
			parlour({
				sections: [{ type: "inquiry" }, { type: "artists" }, { type: "work" }],
			}),
			[SITA, ARJUN],
			work,
		);
		const main = mainOf(html);
		const order = ["inquiry", "artists", "recent-work"].map((id) =>
			main.indexOf(`id="${id}"`),
		);
		assert.ok(order.every((index) => index > 0));
		assert.deepEqual(
			[...order].sort((a, b) => a - b),
			order,
		);
		const hidden = homeHtml(parlour({ sections: [{ type: "inquiry" }] }));
		assert.doesNotMatch(hidden, /id="artists"|id="recent-work"/);
	});

	test("a sparse studio: no flash, photos, artists, intro or contacts; type alone under three stars", () => {
		const html = homeHtml(
			parlour({}, EMPTY_STUDIO),
			[],
			null,
			EMPTY_FLASH_PAGE,
		);
		assertSafePage(html);
		assertUniqueIds(html);
		assert.doesNotMatch(html, /<img/);
		assert.match(
			html,
			/<div class="fp-hero-ornament" aria-hidden="true"><svg class="fp-star fp-star-red"/,
		);
		assert.match(html, /No photos of work to show here yet\./);
		assert.doesNotMatch(html, /See the work|id="artists"|fp-intro/);
		assert.doesNotMatch(html, /fp-footer-(contact|visit|follow)/);
		assert.doesNotMatch(html, /id="good-to-know"/);
	});

	test("a closed studio offers no general booking link and says so; each design asks for itself as its artist's flash setting says", () => {
		// `requestable` is the artist's flash setting (the API's), not the studio's switch.
		const flash = flashWith(3, (design, index) =>
			index === 1 ? { ...design, requestable: false, price: null } : design,
		);
		const html = homeHtml(
			parlour({}, CLOSED_STUDIO),
			[{ ...SITA, acceptingInquiries: false }, ARJUN],
			null,
			flash,
		);
		assertSafePage(html);
		assert.equal(html.match(/<li class="fp-card/g)?.length, 3);
		assert.doesNotMatch(html, /href="\/book"/);
		assert.match(html, /Not taking new inquiries right now/);
		assert.equal(html.match(/class="fp-card-request"/g)?.length, 2);
		const closed = /<li class="fp-card fp-card-closed">([\s\S]*?)<\/li>/.exec(
			html,
		)?.[1];
		assert.ok(closed, "the design its artist takes no requests for");
		assert.doesNotMatch(closed, /fp-card-request|Ask for a price|Price:/);
		assert.match(closed, /Not taking flash requests right now/);
	});

	test("a long Devanagari name wraps (clamped to two lines in the header) and never widens the page", () => {
		const name = `${"Shree Ganesh Traditional Tattoo Parlour ".repeat(3)}श्री गणेश ट्याटु पसल`;
		const html = homeHtml(
			parlour({}, { ...STUDIO, name }),
			[SITA],
			null,
			flashPage(2),
		);
		assertSafePage(html);
		assert.match(html, /<span class="brand-name" dir="auto">Shree Ganesh/);
		assert.match(css, /\.fp-brand \.brand-name[^{]*\{[^}]*line-clamp: 2/);
		assert.match(css, /\.fp-brand \{[^}]*overflow-wrap: anywhere/);
		assert.match(
			ruleOf(pagesCss, ".fp-page-title,\n.fp-hero-name,\n.fp-artist-title"),
			/overflow-wrap: anywhere/,
		);
		assert.match(ruleOf(pagesCss, ".fp-card-name"), /overflow-wrap: anywhere/);
	});

	test("the footer shows the studio's own hours and the Good to know section is the shared one", () => {
		const html = homeHtml(parlour({}, GOOD_TO_KNOW_STUDIO));
		assertSafePage(html);
		assert.match(html, /<dl class="fp-footer-hours">/);
		assert.match(html, /id="good-to-know"/);
	});
});

describe("Flash Parlour's flash pages", () => {
	function flashHtml(page: unknown, search = {}, studio = parlour()) {
		return renderToStaticMarkup(
			createElement(ThemedFlashPage, {
				data: flashPageData(
					studio,
					[SITA, ARJUN],
					page,
					search,
					ORIGIN,
					IMAGE_ORIGIN,
				),
			}),
		);
	}

	test("/flash: the whole wall in the shell, every design a sheet, a claimed one greyed and stamped", () => {
		const page = flashWith(4, (design, index) =>
			index === 2
				? { ...design, status: "claimed" as const, requestable: false }
				: design,
		);
		const html = flashHtml(page);
		assertSafePage(html);
		assertUniqueIds(html);
		assert.match(html, /<header class="fp-header">/);
		assert.match(
			html,
			/<main id="main" tabindex="-1" class="fp-main fp-flash">/,
		);
		assert.match(
			html,
			/<h1 id="flash-page-title" class="fp-page-title">Flash<\/h1>/,
		);
		assert.match(html, /<a[^>]*aria-current="page"[^>]*>Flash<\/a>/);
		assert.match(html, /<ul class="fp-flash-grid" role="list">/);
		assert.equal(html.match(/<li class="fp-card/g)?.length, 4);
		const claimed = /<li class="fp-card fp-card-claimed">([\s\S]*?)<\/li>/.exec(
			html,
		)?.[1];
		assert.ok(claimed, "the claimed sheet");
		assert.match(claimed, /<span class="fp-card-stamp">Claimed<\/span><\/a>/);
		assert.doesNotMatch(claimed, /fp-card-request|Ask for a price/);
		assert.equal(html.match(/class="fp-card-request"/g)?.length, 3);
		// Bring your own idea, while the studio takes requests.
		assert.match(html, /Don&#x27;t see the one\? Bring your own idea\./);
	});

	test("the artist filter shows for two artists; Show more and Back to the newest are plain links", () => {
		const page = flashPage(2, {
			nextCursor: "c2",
			filters: {
				artists: [
					{ slug: "sita", name: "Sita Rai" },
					{ slug: "arjun", name: "अर्जुन थापा" },
				],
			},
		});
		const html = flashHtml(page, { cursor: "c1" });
		assertSafePage(html);
		assert.match(html, /<nav class="fp-filters" aria-label="Whose flash">/);
		assert.match(
			html,
			/href="\/flash\?artist=arjun"><bdi>अर्जुन थापा<\/bdi><\/a>/,
		);
		assert.match(html, /href="\/flash\?cursor=c2">Show more</);
		assert.match(html, /href="\/flash">Back to the newest</);
		// A later page's pictures load lazily.
		assert.doesNotMatch(html, /loading="eager"/);
	});

	test("no flash, or none by this artist: it says so, with the way back", () => {
		const empty = flashHtml(EMPTY_FLASH_PAGE);
		assertSafePage(empty);
		assert.match(empty, /No flash designs yet\./);
		assert.match(empty, /href="\/">Go to the studio page</);
		const none = flashHtml(EMPTY_FLASH_PAGE, { artist: "sita" });
		assert.match(none, /No flash designs by this artist\./);
		assert.match(none, /href="\/flash">Show all flash</);
	});

	function designHtml(
		design: unknown,
		artists: Artist[] = [SITA, ARJUN],
		studio = parlour(),
	) {
		const data = flashDesignPageData(
			studio,
			artists,
			design,
			ORIGIN,
			IMAGE_ORIGIN,
		);
		assert.ok(data);
		return renderToStaticMarkup(createElement(ThemedFlashDesignPage, { data }));
	}

	test("a design's page: pinned up large and whole, its ticket, and Request this design", () => {
		const html = designHtml(flashPage(1).data[0]);
		assertSafePage(html);
		assertUniqueIds(html);
		assert.match(
			html,
			/<main id="main" tabindex="-1" class="fp-main fp-design">/,
		);
		assert.match(html, /<a[^>]*aria-current="true"[^>]*>Flash<\/a>/);
		const picture = /<img class="fp-design-picture"[^>]*>/.exec(html)?.[0];
		assert.ok(picture);
		assert.match(picture, /fetchPriority="high"/);
		assert.match(
			picture,
			/ width="1200" height="1200" alt="Moth, a flash design by Sita Rai"/,
		);
		assert.match(
			html,
			/<h1 id="flash-design-title" class="fp-design-title user-text" dir="auto">Moth<\/h1>/,
		);
		assert.match(html, /<dd>NPR 3,000<\/dd>/);
		assert.match(
			html,
			/fp-design-state-available user-text" dir="auto"><svg class="fp-star fp-star-green fp-state-star"[^>]*aria-hidden="true"[\s\S]*?<\/svg>Available<\/dd>/,
		);
		assert.match(
			html,
			new RegExp(
				`<a class="action action-primary fp-cta" href="/book\\?flash=${flashId(1)}">Request this design</a>`,
			),
		);
		assert.match(
			html,
			/href="\/flash\?artist=sita"><span>All flash by <bdi>Sita Rai<\/bdi><\/span>/,
		);
		assert.match(html, /href="\/flash">Back to the flash</);
	});

	test("a claimed design: greyed, stamped, Claimed in words, and something similar from the artist", () => {
		const claimed = {
			...flashPage(2).data[1],
			status: "claimed" as const,
			requestable: false,
		};
		const html = designHtml(claimed);
		assertSafePage(html);
		assert.match(
			html,
			/<figure class="fp-design-sheet fp-design-sheet-claimed">/,
		);
		assert.match(
			html,
			/<span class="fp-card-stamp fp-design-stamp" aria-hidden="true">Claimed<\/span>/,
		);
		assert.match(
			html,
			/fp-design-state-claimed user-text" dir="auto">Claimed<\/dd>/,
		);
		assert.match(
			html,
			/Someone has claimed this design: it was one of a kind\./,
		);
		assert.match(html, />Ask for something similar</);
		// An unpriced claimed design has no price row at all.
		assert.doesNotMatch(html, /Ask for a price/);
	});

	test("a design its artist isn't taking: their own words, and nothing to request", () => {
		const html = designHtml({ ...flashPage(1).data[0], requestable: false }, [
			{ ...SITA, acceptingInquiries: false, closedMessage: "Back in March." },
			ARJUN,
		]);
		assertSafePage(html);
		assert.match(
			html,
			/fp-design-state-closed user-text" dir="auto">Back in March\.<\/dd>/,
		);
		assert.doesNotMatch(html, /href="\/book\?flash=/);
	});
});

describe("Flash Parlour's artist pages", () => {
	function artistHtml(
		artists: Artist[],
		flash: unknown = flashPage(2),
		studio = parlour(),
	) {
		const data = artistPageData(
			studio,
			artists,
			"sita",
			ORIGIN,
			IMAGE_ORIGIN,
			{ page: galleryPage(3), search: {} },
			flash,
		);
		assert.ok(data);
		return renderToStaticMarkup(createElement(ThemedArtistPage, { data }));
	}

	test("the card and name open the page, then their flash on the wall, then their work", () => {
		const html = artistHtml([SITA, ARJUN]);
		assertSafePage(html);
		assertUniqueIds(html);
		assert.match(html, /<h1 class="fp-artist-title" dir="auto">Sita Rai<\/h1>/);
		const title = html.indexOf("<h1");
		const flash = html.indexOf('id="flash"');
		const work = html.indexOf('id="work"');
		assert.ok(title < flash && flash < work, "name, flash, then work");
		// Their own page doesn't name them on each sheet.
		assert.doesNotMatch(html, /class="fp-card-by"/);
		assert.equal(html.match(/<li class="fp-piece">/g)?.length, 3);
		assert.match(html, /href="#flash">Flash</);
		assert.match(html, /aria-current="true"[^>]*>Artists</);
	});

	test("without flash or a portrait: no wall, and the frame holds their initial on a star", () => {
		const html = artistHtml(
			[{ ...SITA, photo: null }, ARJUN],
			EMPTY_FLASH_PAGE,
		);
		assertSafePage(html);
		assert.doesNotMatch(html, /id="flash"|href="#flash"/);
		assert.match(
			html,
			/<span class="fp-frame fp-frame-large fp-frame-initial" aria-hidden="true"><svg class="fp-star fp-star-mustard fp-frame-star"[\s\S]*?<span class="fp-frame-letter">S<\/span><\/span>/,
		);
	});

	test("the initial is the first letter as a reader sees it", () => {
		assert.ok(initialOf("श्री गणेश").startsWith("श्"));
		assert.equal(initialOf("  Aiko"), "A");
		assert.equal(initialOf("Émile"), "É");
	});

	test("a closed artist in an open studio: the invitation says who is closed and where the request goes", () => {
		const data = artistPageData(
			parlour(),
			[SITA, ARJUN],
			"arjun",
			ORIGIN,
			IMAGE_ORIGIN,
		);
		assert.ok(data);
		const html = renderToStaticMarkup(
			createElement(ThemedArtistPage, { data }),
		);
		assertSafePage(html);
		const invite = html.slice(html.indexOf('id="inquiry"'));
		assert.match(
			invite,
			/<bdi>अर्जुन थापा<\/bdi> isn&#x27;t taking new work right now\. A request from here goes to <bdi>Black Needle<\/bdi>\./,
		);
		assert.doesNotMatch(html, /href="\/book\?artist=arjun"/);
	});

	test("the directory: every artist a card with one link, the filter only when it narrows", () => {
		const data = artistsPageData(
			parlour(),
			[sitaWithWork(3), ARJUN],
			{},
			ORIGIN,
			IMAGE_ORIGIN,
		);
		const html = renderToStaticMarkup(
			createElement(ThemedArtistsPage, { data }),
		);
		assertSafePage(html);
		assertUniqueIds(html);
		assert.match(html, /<h1 class="fp-page-title">The artists<\/h1>/);
		assert.equal(html.match(/class="fp-artist-card"/g)?.length, 2);
		assert.match(
			html,
			/<a class="fp-artist-link" href="\/artists\/sita">Sita Rai<\/a>/,
		);
		assert.match(
			html,
			/<span class="fp-frame"><img [^>]*alt="Photo of Sita Rai"/,
		);
		assert.match(
			html,
			/<p class="fp-status fp-status-open">Taking new work<\/p>/,
		);
		assert.match(html, /id="inquiry"/);
		const empty = renderToStaticMarkup(
			createElement(ThemedArtistsPage, {
				data: artistsPageData(parlour(), [], {}, ORIGIN, IMAGE_ORIGIN),
			}),
		);
		assertSafePage(empty);
		assert.match(empty, /No artists to show here yet\./);
	});
});

describe("Flash Parlour's work and tattoo pages", () => {
	test("the work: every tattoo whole, each one link to its page, the API's filters as chips", () => {
		const data = workPageData(
			parlour(),
			[SITA, ARJUN],
			galleryPage(4),
			{},
			ORIGIN,
			IMAGE_ORIGIN,
		);
		const html = renderToStaticMarkup(createElement(ThemedWorkPage, { data }));
		assertSafePage(html);
		assertUniqueIds(html);
		assert.match(html, /<h1 class="fp-page-title">The work<\/h1>/);
		assert.equal(html.match(/class="fp-piece-link"/g)?.length, 4);
		assert.match(html, new RegExp(`href="/gallery/${photoId(1)}"`));
		assert.match(html, /href="\/gallery\?style=fine-line"/);
		assert.match(html, /href="\/gallery\?healed=1"/);
		const [first = "", second = ""] =
			html.match(/<img class="fp-piece-photo"[^>]*>/g) ?? [];
		assert.match(first, /loading="eager"/);
		assert.match(second, /loading="lazy"/);
		// A 4:3 photo under a 70vh and 48rem cap, three across from 78.5rem.
		assert.match(
			pieceSizes({ width: 2048, height: 1536 }),
			/^\(min-width: 78\.5rem\) min\(24rem, calc\(70vh \* 1\.34\), 64rem\)/,
		);
	});

	test("an empty gallery says so; a filtered one offers the way back", () => {
		const html = renderToStaticMarkup(
			createElement(ThemedWorkPage, {
				data: workPageData(parlour(), [SITA], null, {}, ORIGIN, IMAGE_ORIGIN),
			}),
		);
		assertSafePage(html);
		assert.match(html, /No photos to show yet\./);
	});

	test("a tattoo's page: whole on its sheet, its ticket, its artist and the similar request", () => {
		const data = artworkPageData(
			parlour(),
			[SITA, ARJUN],
			galleryPage(1).data[0],
			[galleryPage(3), null, null],
			ORIGIN,
			IMAGE_ORIGIN,
		);
		assert.ok(data);
		const html = renderToStaticMarkup(
			createElement(ThemedArtworkPage, { data }),
		);
		assertSafePage(html);
		assertUniqueIds(html);
		assert.match(html, /<figure class="fp-plate fp-artwork-figure">/);
		assert.match(html, /<img class="artwork-photo"[^>]*fetchPriority="high"/);
		assert.match(html, /<div class="fp-ticket fp-colophon">/);
		assert.match(html, /<h1 class="fp-artwork-title user-text"/);
		assert.match(html, /Request a similar tattoo/);
		assert.match(html, /aria-current="page"[^>]*>Gallery</);
		assert.match(
			html,
			/<p class="fp-kicker user-text" dir="auto">Black Needle<\/p>/,
		);
	});
});

describe("Flash Parlour carries the shared pages: booking and information", () => {
	test("/book: the shared flow under its opening, whose h1 names the form; a flash request shows the design", () => {
		const data = requestPageData(
			parlour(),
			[SITA, ARJUN],
			{},
			ORIGIN,
			IMAGE_ORIGIN,
		);
		const html = renderToStaticMarkup(
			createElement(ThemedRequestPage, { data }),
		);
		assertSafePage(html);
		assertUniqueIds(html);
		assert.match(
			html,
			/<h1 id="inquiry-title" class="fp-page-title">Request a session<\/h1>/,
		);
		assert.match(
			html,
			/<main id="main" tabindex="-1" class="fp-main fp-book">/,
		);
		assert.doesNotMatch(html, /fp-header-cta/);
		const flash = requestPageData(
			parlour(),
			[SITA, ARJUN],
			{ flash: flashId(1) },
			ORIGIN,
			IMAGE_ORIGIN,
			{ kind: "found", design: flashPage(1).data[0] },
		);
		const flashHtml = renderToStaticMarkup(
			createElement(ThemedRequestPage, { data: flash }),
		);
		assertSafePage(flashHtml);
		assert.match(flashHtml, /class="flash-summary"/);
	});

	test("/about renders inside the shell, framed by the stylesheet", () => {
		const about = infoPageData(
			"about",
			parlour(),
			[SITA, ARJUN],
			ORIGIN,
			IMAGE_ORIGIN,
		);
		assert.ok(about);
		const html = renderToStaticMarkup(
			createElement(ThemedInfoPage, { data: about }),
		);
		assertSafePage(html);
		assert.match(html, /<footer class="fp-footer">/);
		assert.match(
			html,
			/<main id="main" tabindex="-1" class="page"><section class="section info-page" aria-labelledby="info-title"><h1 id="info-title" class="section-title">About<\/h1>/,
		);
		assert.match(
			css,
			/:root\.theme-flash-parlour main\.page > section > \.section-title:first-child,\n:root\.theme-flash-parlour \.status-page > \.section-title \{ text-align: center;/,
		);
	});

	test("the not-found and error pages take the frame: centred under the stars, with their own padding", () => {
		for (const html of [
			renderToStaticMarkup(createElement(NotFoundPage)),
			renderToStaticMarkup(createElement(ErrorPage, { retryHref: "/flash" })),
		]) {
			assert.match(
				html,
				/^<main class="page status-page"><h1 class="section-title">/,
			);
		}
		assert.match(
			css,
			/:root\.theme-flash-parlour main\.page\.status-page \{ justify-items: center; padding-block: [^;]+; text-align: center; \}/,
		);
	});
});

describe("the other themes are unchanged by Flash Parlour", () => {
	test("their shells and home pages draw nothing of it", () => {
		for (const theme of ["stencil-and-ink", "ink-noir", "irezumi", "atelier"]) {
			const html = homeHtml(
				withStorefront({ ...DEFAULT_STOREFRONT, theme }),
				[SITA, ARJUN],
				null,
				flashPage(8),
			);
			assert.doesNotMatch(html, /fp-/, theme);
		}
	});
});

/**
 * The flash reads a page's loader makes (their URLs), for a studio saved as
 * it is, previewed in `preview` when given (Page look's "Preview" links).
 */
async function flashReads(
	studio: Studio,
	load: typeof loadStudioPage | typeof loadRequestPage,
	preview: ThemeKey | null = null,
	flash: unknown = EMPTY_FLASH_PAGE,
): Promise<string[]> {
	const API = "http://api.test";
	const { calls, fetch } = fakeFetch(({ url }) => {
		if (url.endsWith("/artists")) return json(200, { data: [SITA] });
		if (url.includes("/work?")) return json(200, galleryPage(0));
		if (url.includes("/flash?")) return json(200, flash);
		return json(404, { error: { code: "not_found", message: "x" } });
	});
	const api = createApiContext("server");
	connectServer(api, { config: { apiUrl: API, mediaUrl: API }, studio, fetch });
	seedStudio(api, studio);
	const site = new SiteRef();
	site.connect(ORIGIN, null, preview);
	await load({ ...api, site }, {});
	return calls
		.map((call) => call.url.replace(`${API}/api/v1/tenants/${STUDIO.slug}`, ""))
		.filter((url) => url.startsWith("/flash"));
}

const ATELIER_SAVED = (): Studio =>
	withStorefront({ ...DEFAULT_STOREFRONT, theme: "atelier" });

describe("the review's fixes", () => {
	test("a preview reads what the previewed theme's home needs: twelve for Flash Parlour, six back in Atelier", async () => {
		assert.deepEqual(
			await flashReads(ATELIER_SAVED(), loadStudioPage, "flash-parlour"),
			["/flash?available=true&limit=12"],
		);
		assert.deepEqual(await flashReads(parlour(), loadStudioPage, "atelier"), [
			"/flash?available=true&limit=6",
		]);
		assert.deepEqual(await flashReads(ATELIER_SAVED(), loadStudioPage), [
			"/flash?available=true&limit=6",
		]);
	});

	test("/book reads whether there is flash only for Flash Parlour with Flash shown, and speaks of the wall only then", async () => {
		assert.deepEqual(await flashReads(parlour(), loadRequestPage), [
			"/flash?available=true&limit=1",
		]);
		assert.deepEqual(
			await flashReads(ATELIER_SAVED(), loadRequestPage, "flash-parlour"),
			["/flash?available=true&limit=1"],
		);
		assert.deepEqual(await flashReads(ATELIER_SAVED(), loadRequestPage), []);
		assert.deepEqual(
			await flashReads(
				parlour({ sections: [{ type: "work" }, { type: "inquiry" }] }),
				loadRequestPage,
			),
			[],
		);
		const line = (hasFlash: boolean) =>
			renderToStaticMarkup(
				createElement(ThemedRequestPage, {
					data: requestPageData(
						parlour(),
						[SITA, ARJUN],
						{},
						ORIGIN,
						IMAGE_ORIGIN,
						null,
						null,
						hasFlash,
					),
				}),
			);
		assert.match(
			line(true),
			/Pick a design off the wall or bring your own idea\./,
		);
		assert.doesNotMatch(line(false), /wall/);
		assert.match(line(false), /Bring your own idea\./);
	});

	test("/flash makes no claim about the designs: pick one and ask", () => {
		const html = renderToStaticMarkup(
			createElement(ThemedFlashPage, {
				data: flashPageData(
					parlour(),
					[SITA],
					flashPage(1),
					{},
					ORIGIN,
					IMAGE_ORIGIN,
				),
			}),
		);
		assert.match(
			html,
			/<p class="fp-page-line">Pick a design and ask for it\.<\/p>/,
		);
		assert.doesNotMatch(html, /ready to tattoo/);
	});

	test("an unpriced design asks for a price only while it can be asked for, on its sheet and its page", () => {
		const closed = { ...flashPage(2).data[1], requestable: false };
		const data = flashDesignPageData(
			parlour(),
			[SITA, ARJUN],
			closed,
			ORIGIN,
			IMAGE_ORIGIN,
		);
		assert.ok(data);
		const page = renderToStaticMarkup(
			createElement(ThemedFlashDesignPage, { data }),
		);
		assert.doesNotMatch(page, /Ask for a price|<dt>Price<\/dt>/);
		const open = flashDesignPageData(
			parlour(),
			[SITA, ARJUN],
			flashPage(2).data[1],
			ORIGIN,
			IMAGE_ORIGIN,
		);
		assert.ok(open);
		assert.match(
			renderToStaticMarkup(
				createElement(ThemedFlashDesignPage, { data: open }),
			),
			/<dt>Price<\/dt><dd>Ask for a price<\/dd>/,
		);
	});

	test("a short wall sits in the middle, its sheets as wide as a full row's", () => {
		const grid = ruleOf(pagesCss, ".fp-flash-grid");
		assert.match(grid, /display: flex;/);
		assert.match(grid, /flex-wrap: wrap;/);
		assert.match(grid, /justify-content: center;/);
		assert.match(
			ruleOf(pagesCss, ".fp-card"),
			/flex: 0 0\s+calc\(\(100% - \(var\(--fp-cols\) - 1\) \* var\(--fp-gap\)\) \/ var\(--fp-cols\)\);/,
		);
		for (const html of [
			homeHtml(parlour(), [SITA], null, flashPage(1)),
			homeHtml(parlour(), [SITA], null, flashPage(2)),
		]) {
			assertSafePage(html);
			assert.match(
				html,
				/<ul class="fp-flash-grid fp-flash-grid-wall" role="list">/,
			);
		}
	});

	test("the invitation's button sits under its centred words; a two-line 'Ask for a price' keeps square corners", () => {
		assert.match(ruleOf(pagesCss, ".fp-band .stack"), /justify-items: center;/);
		assert.match(
			ruleOf(pagesCss, ".fp-card-price-ask"),
			/border-radius: var\(--radius\);/,
		);
	});
});

/** `text` as a literal in a regular expression. */
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The width in px a `sizes` list asks for at `viewport` px (the browser's
 * choice: the first entry whose `(min-width: …rem)` holds, else the last),
 * for the shapes sizes.ts writes: rem, vw, vh, calc() and min(). A screen
 * 800 px tall.
 */
function evaluateSizes(sizes: string, viewport: number, rem: number): number {
	const entries: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < sizes.length; i++) {
		if (sizes[i] === "(") depth++;
		if (sizes[i] === ")") depth--;
		if (sizes[i] === "," && depth === 0) {
			entries.push(sizes.slice(start, i).trim());
			start = i + 1;
		}
	}
	entries.push(sizes.slice(start).trim());
	for (const entry of entries) {
		const media = /^\(min-width: ([\d.]+)rem\) (.*)$/.exec(entry);
		if (media && viewport < Number(media[1]) * rem) continue;
		const value = media ? media[2] : entry;
		const js = value
			.replaceAll("min(", "Math.min(")
			.replaceAll("calc(", "(")
			.replace(/([\d.]+)rem/g, `($1*${rem})`)
			.replace(/([\d.]+)vw/g, `($1*${viewport}/100)`)
			.replace(/([\d.]+)vh/g, "($1*800/100)");
		assert.match(js, /^[\d\s.()*+/,-]*(Math\.min[\d\s.()*+/,-]*)*$/, js);
		return Function(`return ${js}`)() as number;
	}
	throw new Error(`no entry applies: ${sizes}`);
}
