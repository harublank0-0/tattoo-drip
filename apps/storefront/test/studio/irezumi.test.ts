import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { Artist, Studio } from "@tattoo-drip/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	artistPageData,
	artistsPageData,
	artworkPageData,
	flashPageData,
	infoPageData,
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
	parseThemeConfig,
	THEME_SECTIONS,
	type ThemeConfig,
} from "../../src/studio/theme/config.ts";
import { matchedThemeKey, THEME_HTML } from "../../src/studio/theme/html.ts";
import { irezumiHome } from "../../src/studio/theme/irezumi/home-view.ts";
import {
	IREZUMI_CLASS,
	IREZUMI_DARK_SCHEME,
	IREZUMI_SCHEME,
	IREZUMI_THEME_COLORS,
} from "../../src/studio/theme/irezumi/theme.ts";
import {
	THEMES,
	ThemedArtistPage,
	ThemedArtistsPage,
	ThemedArtworkPage,
	ThemedFlashPage,
	ThemedInfoPage,
	ThemedRequestPage,
	ThemedStudioPage,
	ThemedWorkPage,
} from "../../src/studio/theme/registry.tsx";
import {
	ARJUN,
	CLOSED_STUDIO,
	DEFAULT_STOREFRONT,
	EMPTY_FLASH_PAGE,
	EMPTY_STUDIO,
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
 * Irezumi (src/studio/theme/irezumi/): an editorial theme on seigaiha
 * paper that follows the device, light or dark. These pin that it is
 * registered end to end (key, sections, <html> class, schemes, theme
 * colours, stylesheet and its paper), that a studio's accent is checked
 * against each scheme's own surfaces, and that each page renders the
 * studio's own data in Irezumi's frame, with sparse data handled without
 * inventing anything.
 */

const css = readFileSync(
	new URL("../../src/studio/theme/irezumi/styles.css", import.meta.url),
	"utf8",
);
const pagesCss = readFileSync(
	new URL("../../src/studio/theme/irezumi/pages.css", import.meta.url),
	"utf8",
);
const appCss = readFileSync(
	new URL("../../src/styles.css", import.meta.url),
	"utf8",
);

function tokensOf(selector: string, from = 0): Map<string, string> {
	const start = css.indexOf(`${selector} {`, from);
	assert.ok(start >= 0, selector);
	const body = css.slice(start, css.indexOf("}", start));
	return new Map(
		Array.from(body.matchAll(/(--[a-z-]+):\s*([^;]+);/g), (match) => [
			match[1],
			match[2].trim(),
		]),
	);
}

const irezumi = (storefront: object = {}, studio: Studio = STUDIO): Studio =>
	withStorefront(
		{ ...DEFAULT_STOREFRONT, theme: "irezumi", ...storefront },
		studio,
	);

const mainOf = (html: string) => {
	const match = /<main[^>]*>([\s\S]*)<\/main>/.exec(html);
	assert.ok(match, "a <main>");
	return match[1];
};
const ids = (html: string) =>
	Array.from(html.matchAll(/ id="([^"]*)"/g), (match) => match[1]);
const assertUniqueIds = (html: string) => {
	const all = ids(html);
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
) {
	return renderToStaticMarkup(
		createElement(ThemedStudioPage, {
			data: studioPageData(studio, artists, ORIGIN, IMAGE_ORIGIN, work),
		}),
	);
}

describe("Irezumi's palette (theme.ts and styles.css agree)", () => {
	const darkMedia = css.indexOf("@media (prefers-color-scheme: dark) {");
	const schemes = [
		{
			name: "light",
			scheme: IREZUMI_SCHEME,
			tokens: tokensOf(":root.theme-irezumi"),
			accent: "#b3321d",
		},
		{
			name: "dark",
			scheme: IREZUMI_DARK_SCHEME,
			tokens: tokensOf(":root.theme-irezumi", darkMedia),
			accent: "#e0664f",
		},
	] as const;

	test("the dark tokens are the first dark media query's, after the light ones", () => {
		assert.ok(darkMedia > css.indexOf(":root.theme-irezumi {"));
		assert.equal(schemes[1].tokens.get("--paper"), "#161412");
	});

	for (const { name, scheme, tokens, accent } of schemes) {
		test(`${name}: the scheme's paper, ink, muted ink and raised surface are the stylesheet's`, () => {
			assert.equal(tokens.get("--paper"), scheme.paper);
			assert.equal(tokens.get("--ink"), scheme.ink);
			assert.equal(tokens.get("--ink-muted"), scheme.inkMuted);
			assert.equal(scheme.surfaces?.[0], tokens.get("--paper-raised"));
			assert.equal(scheme.surfaces?.length, 3, "and the two textured averages");
			assert.equal(tokens.get("--on-stencil"), scheme.paper);
		});

		test(`${name}: the vermilion's tokens are what a studio's own accent would get here`, () => {
			assert.equal(tokens.get("--stencil"), accent);
			assert.deepEqual(accentTokens(accent, scheme), {
				stencil: accent,
				stencilStrong: tokens.get("--stencil-strong"),
				stencilWash: tokens.get("--stencil-wash"),
			});
		});

		test(`${name}: text, the accent and control borders read on the paper, the raised surface and both under their texture`, () => {
			for (const surface of [scheme.paper, ...(scheme.surfaces ?? [])]) {
				for (const token of [
					"--ink",
					"--ink-muted",
					"--stencil",
					"--stencil-strong",
				]) {
					const color = tokens.get(token) as string;
					assert.ok(
						contrastRatio(color, surface) >= 4.5,
						`${token} on ${surface}`,
					);
				}
				const border = tokens.get("--line-strong") as string;
				assert.ok(contrastRatio(border, surface) >= 3, "--line-strong");
			}
			assert.ok(
				contrastRatio(scheme.paper, tokens.get("--stencil") as string) >= 4.5,
				"text on the accent",
			);
		});
	}

	test("each scheme is its device's: light by default, dark on a device that prefers it, and imported", () => {
		assert.equal(css.match(/(?<!prefers-)color-scheme:\s*light/g)?.length, 1);
		assert.equal(css.match(/(?<!prefers-)color-scheme:\s*dark/g)?.length, 1);
		assert.doesNotMatch(css + pagesCss, /@import/);
		assert.match(appCss, /@import '\.\/studio\/theme\/irezumi\/styles\.css';/);
		assert.match(appCss, /@import '\.\/studio\/theme\/irezumi\/pages\.css';/);
		// shadcn's `dark:` follows the device under Irezumi, as its tokens do.
		const variant = appCss.slice(appCss.indexOf("@custom-variant dark"));
		assert.doesNotMatch(
			variant.slice(0, variant.indexOf("@theme")),
			/theme-irezumi/,
		);
	});

	test("the paper loads nothing: its only images are its own small SVG tiles, which the build inlines", () => {
		assert.doesNotMatch(pagesCss, /url\(/);
		const urls = Array.from(css.matchAll(/url\(([^)]*)\)/g), (match) =>
			match[1].replace(/^'|'$/g, ""),
		);
		assert.deepEqual(
			new Set(urls),
			new Set([
				"./paper/grain-light.svg",
				"./paper/seigaiha-light.svg",
				"./paper/grain-dark.svg",
				"./paper/seigaiha-dark.svg",
			]),
		);
		for (const url of new Set(urls)) {
			const file = new URL(
				`../../src/studio/theme/irezumi/${url}`,
				import.meta.url,
			);
			assert.ok(existsSync(file), url);
			const svg = readFileSync(file, "utf8");
			// Under Vite's inline limit (4 KiB), so it is a data: URL in the CSS.
			assert.ok(svg.length < 4096, `${url} is small`);
			// Nothing from elsewhere: no address but the SVG namespace and its own ids.
			assert.deepEqual(
				Array.from(svg.matchAll(/(?:href|url)\s*[=(]\s*"?([^")\s]*)/g), (m) =>
					m[1].startsWith("#") ? "#" : m[1],
				).filter((ref) => ref !== "#"),
				[],
				`${url} refers only to itself`,
			);
			assert.doesNotMatch(svg, /<script|<image|<foreignObject|on[a-z]+=/i);
		}
	});

	test("each scheme's tile is drawn in its own paper and ink", () => {
		for (const [name, scheme] of [
			["light", IREZUMI_SCHEME],
			["dark", IREZUMI_DARK_SCHEME],
		] as const) {
			const read = (file: string) =>
				readFileSync(
					new URL(
						`../../src/studio/theme/irezumi/paper/${file}-${name}.svg`,
						import.meta.url,
					),
					"utf8",
				);
			const waves = read("seigaiha");
			assert.match(waves, new RegExp(`fill="${scheme.paper}"`));
			assert.match(waves, new RegExp(`stroke="${scheme.ink}"`));
			// The grain's colour is the ink's, as 0–1 channels.
			const channels = [1, 3, 5].map((index) =>
				Number(
					(
						Number.parseInt(scheme.ink.slice(index, index + 2), 16) / 255
					).toFixed(4),
				),
			);
			const matrix = /values="([^"]*)"/
				.exec(read("grain"))?.[1]
				.split(" ")
				.map(Number);
			assert.deepEqual([matrix?.[4], matrix?.[9], matrix?.[14]], channels);
		}
	});

	test("the page takes the waves and the grain; the footer and the bands take the grain alone, in each scheme", () => {
		const dark = css.slice(
			css.indexOf(
				"@media (prefers-color-scheme: dark)",
				css.indexOf("The paper:"),
			),
		);
		for (const [block, name] of [
			[css, "light"],
			[dark, "dark"],
		] as const) {
			assert.match(
				block,
				new RegExp(
					`:root\\.theme-irezumi body \\{[^}]*background-image: url\\('\\./paper/grain-${name}\\.svg'\\), url\\('\\./paper/seigaiha-${name}\\.svg'\\)`,
				),
			);
			assert.match(
				block,
				new RegExp(
					`:root\\.theme-irezumi \\.irz-footer,\\s*:root\\.theme-irezumi \\.irz-band \\{ background-image: url\\('\\./paper/grain-${name}\\.svg'\\); \\}`,
				),
			);
		}
		assert.doesNotMatch(css + pagesCss, /background-attachment:\s*fixed/);
	});

	test("the ink-wash ring is drawn in the scheme's ink, never a fixed colour", () => {
		const start = pagesCss.indexOf(".irz-hero-wash {");
		const rule = pagesCss.slice(start, pagesCss.indexOf("}", start));
		assert.doesNotMatch(rule, /rgb\(|#[0-9a-f]{3,6}\b/i);
		assert.match(rule, /color-mix\(in srgb, var\(--ink\) 82%, transparent\)/);
	});

	test("every rule is scoped: it starts at the theme's class or an irz- class", () => {
		const scoped =
			/^(:root\.theme-irezumi\b|:root:has\(\.chat-float\) \.irz-|\.irz-)/;
		for (const sheet of [css, pagesCss]) {
			const body = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
			// Every prelude before a `{`, inside @media and @supports blocks too.
			const preludes = Array.from(body.matchAll(/([^{};]+)\{/g), (match) =>
				match[1].trim(),
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

	test("tattoo photos keep their space before they load: full width, height from their shape, drawn whole", () => {
		for (const selector of [
			".irz-hero-photo",
			".irz-piece-photo",
			".irz-artwork-figure .artwork-photo",
		]) {
			const start = pagesCss.indexOf(`${selector}`);
			const rule = pagesCss.slice(start, pagesCss.indexOf("}", start));
			assert.match(rule, /inline-size: 100%/, selector);
			assert.match(rule, /block-size: auto/, selector);
			assert.match(rule, /object-fit: contain/, selector);
			assert.doesNotMatch(rule, /inline-size: auto/, selector);
		}
	});
});

describe("Irezumi's registration", () => {
	test("its sections are every theme's", () => {
		assert.deepEqual(THEME_SECTIONS.irezumi, THEME_SECTIONS["ink-noir"]);
	});

	test("THEME_HTML: its class, no fixed scheme but its two, and each paper as the browser's colour in its scheme", () => {
		assert.equal(IREZUMI_CLASS, "theme-irezumi");
		assert.deepEqual(THEME_HTML.irezumi, {
			className: IREZUMI_CLASS,
			scheme: null,
			schemes: { light: IREZUMI_SCHEME, dark: IREZUMI_DARK_SCHEME },
			themeColors: IREZUMI_THEME_COLORS,
		});
		assert.deepEqual(IREZUMI_THEME_COLORS, [
			{ content: "#f6f1e7", media: "(prefers-color-scheme: light)" },
			{ content: "#161412", media: "(prefers-color-scheme: dark)" },
		]);
	});

	test("the matched page is Irezumi for a studio that picked it, but never the deposit page", () => {
		const root = { routeId: "__root__", loaderData: irezumi() };
		assert.equal(matchedThemeKey([root, { routeId: "/" }]), "irezumi");
		assert.equal(
			matchedThemeKey([root, { routeId: "/gallery/$photo" }]),
			"irezumi",
		);
		assert.equal(
			matchedThemeKey([root, { routeId: "/deposit" }]),
			"stencil-and-ink",
		);
	});

	test("its pages are Irezumi's own, with the shared flash and informational pages", () => {
		const theme = THEMES.irezumi;
		assert.equal(theme.Shell.name, "IrezumiShell");
		assert.equal(theme.StudioPage.name, "IrezumiStudioPage");
		assert.equal(theme.ArtistsPage.name, "IrezumiArtistsPage");
		assert.equal(theme.ArtistPage.name, "IrezumiArtistPage");
		assert.equal(theme.WorkPage.name, "IrezumiGalleryPage");
		assert.equal(theme.ArtworkPage.name, "IrezumiArtworkPage");
		assert.equal(theme.RequestPage.name, "IrezumiBookPage");
		assert.equal(theme.FlashPage, THEMES["stencil-and-ink"].FlashPage);
		assert.equal(theme.InfoPage, THEMES["stencil-and-ink"].InfoPage);
	});
});

describe("brandingCss for Irezumi: each scheme in its media query, checked on its own surfaces", () => {
	const config = (values: Partial<ThemeConfig>): ThemeConfig => ({
		...parseThemeConfig({ theme: "irezumi" }, null),
		...values,
	});
	const LIGHT_RULE =
		/@media \(prefers-color-scheme: light\)\{html:root\.theme-irezumi\{--stencil:([^;]+);/;
	const DARK_RULE =
		/@media \(prefers-color-scheme: dark\)\{html:root\.theme-irezumi\{--stencil:([^;]+);/;

	test("without a brand there is no <style>", () => {
		assert.equal(brandingCss(config({})), null);
	});

	test("an accent that reads on the light paper is set there as it is; the dark scheme gets it lightened until it reads", () => {
		const out = brandingCss(config({ accent: "#0f5e58" }));
		assert.ok(out);
		assert.ok(isSafeCss(out));
		assert.equal(LIGHT_RULE.exec(out)?.[1], "#0f5e58");
		const dark = DARK_RULE.exec(out)?.[1];
		assert.ok(dark && dark !== "#0f5e58");
		for (const surface of [
			IREZUMI_DARK_SCHEME.paper,
			...(IREZUMI_DARK_SCHEME.surfaces ?? []),
		]) {
			assert.ok(contrastRatio(dark, surface) >= 4.5, surface);
		}
		assert.doesNotMatch(
			out,
			/(^|\})html:root\.theme-irezumi\{--stencil/,
			"never outside a media query",
		);
	});

	test("the studio's dark-mode colour is used in the dark scheme when it reads on every dark surface", () => {
		const out = brandingCss(
			config({ accent: "#0f5e58", accentDark: "#7dd3c8" }),
		);
		assert.equal(DARK_RULE.exec(out ?? "")?.[1], "#7dd3c8");
		assert.equal(LIGHT_RULE.exec(out ?? "")?.[1], "#0f5e58");
	});

	test("an accent that reads on the paper but not on the raised surface keeps the light vermilion", () => {
		// #0f766e passes the platform's check on Stencil & Ink's paper (4.95:1)
		// and Irezumi's paper (4.86:1), but not its raised surface (4.37:1).
		const paperOnly = "#0f766e";
		assert.ok(contrastRatio(paperOnly, IREZUMI_SCHEME.paper) >= 4.5);
		assert.ok(
			contrastRatio(paperOnly, (IREZUMI_SCHEME.surfaces ?? [])[0]) < 4.5,
		);
		assert.doesNotMatch(
			brandingCss(config({ accent: paperOnly })) ?? "",
			LIGHT_RULE,
		);
	});

	test("an accent that reads on the flat paper but not on the paper as drawn keeps the vermilion", () => {
		// #2a744a reads on the flat light paper (5.0:1) and raised paper (4.54:1),
		// not on the raised paper as drawn (4.46:1).
		const [raised, , texturedRaised] = IREZUMI_SCHEME.surfaces ?? [];
		const flatOnly = "#2a744a";
		assert.ok(contrastRatio(flatOnly, IREZUMI_SCHEME.paper) >= 4.5);
		assert.ok(contrastRatio(flatOnly, raised) >= 4.5);
		assert.ok(contrastRatio(flatOnly, texturedRaised) < 4.5);
		assert.doesNotMatch(
			brandingCss(config({ accent: flatOnly })) ?? "",
			LIGHT_RULE,
		);
	});

	test("a pale accent that can't be read on the light paper keeps the light vermilion, but serves the dark scheme", () => {
		const out = brandingCss(config({ accent: "#fca5a5" })) ?? "";
		assert.doesNotMatch(out, LIGHT_RULE);
		assert.equal(DARK_RULE.exec(out)?.[1], "#fca5a5");
	});

	test("the studio's font still applies", () => {
		assert.match(
			brandingCss(config({ font: "serif" })) ?? "",
			/html:root\.theme-irezumi\{--display-face:/,
		);
	});
});

describe("the booking form's Turnstile widget follows the page's scheme", () => {
	test("Irezumi and Stencil & Ink follow the device; Ink Noir is dark and Atelier light on any device", () => {
		assert.equal(challengeThemeFor("irezumi"), "auto");
		assert.equal(challengeThemeFor("stencil-and-ink"), "auto");
		assert.equal(challengeThemeFor("ink-noir"), "dark");
		assert.equal(challengeThemeFor("atelier"), "light");
	});
});

describe("Irezumi's home page", () => {
	const work = galleryPage(8);

	test("the shell: skip link, header with nav and booking, <main id=main>, footer", () => {
		const html = homeHtml(irezumi(), [SITA, ARJUN], work);
		assertSafePage(html);
		assertUniqueIds(html);
		assert.match(html, /<a class="irz-skip" href="#main">/);
		assert.match(html, /<header class="irz-header">/);
		assert.match(
			html,
			/<main id="main" tabindex="-1" class="irz-main irz-home">/,
		);
		assert.match(html, /<footer class="irz-footer">/);
		assert.match(html, /class="irz-menu-button"[^>]*aria-expanded="false"/);
		assert.match(html, /<a[^>]*aria-current="page"[^>]*>Home<\/a>/);
		assert.doesNotMatch(html, /class="(site-bar|ink-header)"/);
	});

	test("the name is the h1, the booking action is beside it, and the strongest piece leads whole", () => {
		const html = homeHtml(irezumi(), [SITA, ARJUN], work);
		assert.match(
			html,
			/<h1 class="irz-hero-name" dir="auto">Black Needle<\/h1>/,
		);
		assert.match(
			html,
			/<div class="irz-hero-actions"><a class="action action-primary irz-cta" href="\/book">Request a session<\/a>/,
		);
		assert.match(html, /href="\/gallery">View the gallery</);
		const lead = /<img class="irz-hero-photo"[^>]*>/.exec(html)?.[0];
		assert.ok(lead, "a lead photo");
		assert.match(lead, /loading="eager"/);
		assert.match(lead, /fetchPriority="high"/);
		assert.match(lead, /w1\.320-640-1280\.jpg/);
		assert.match(html, />Featured piece</);
	});

	test("the cover leads when the studio has one", () => {
		const html = homeHtml(
			irezumi({}, { ...STUDIO, cover: COVER_SIZED }),
			[SITA, ARJUN],
			work,
		);
		assertSafePage(html, { brandImages: true });
		assert.match(html, /<img class="irz-hero-photo"[^>]*cover\.jpg/);
		assert.doesNotMatch(html, /Featured piece/);
		// The cover's shape caps its width under the height cap.
		assert.match(
			html,
			/sizes="\(min-width: 78\.5rem\) min\(44\.34rem, calc\(78vh \* 2\), 104rem\)/,
		);
	});

	test("without a cover the largest piece leads and is not repeated in the selected work", () => {
		const data = studioPageData(
			irezumi(),
			[SITA, ARJUN],
			ORIGIN,
			IMAGE_ORIGIN,
			work,
		);
		const home = irezumiHome(data);
		assert.equal(home.lead?.source, "work");
		assert.ok(home.selected.every((photo) => photo.src !== home.lead?.src));
		assert.equal(home.selected.length, 6);
	});

	test("the sections follow the studio's Page look order, and hidden ones are left out", () => {
		const html = homeHtml(
			irezumi({
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
		const hidden = homeHtml(irezumi({ sections: [{ type: "inquiry" }] }));
		assert.doesNotMatch(hidden, /id="artists"|id="recent-work"/);
	});

	test("a sparse studio: no photos, no artists, no intro, no contacts; nothing is made up", () => {
		const html = homeHtml(irezumi({}, EMPTY_STUDIO), [], null);
		assertSafePage(html);
		assertUniqueIds(html);
		assert.doesNotMatch(html, /<img/);
		assert.match(html, /class="irz-hero-wash" aria-hidden="true"/);
		assert.match(html, /No pieces to show here yet\./);
		assert.doesNotMatch(html, /View the gallery|id="artists"|irz-intro/);
		assert.doesNotMatch(html, /irz-footer-(contact|visit|follow)/);
		// Good to know is empty: no empty wrapper for it either.
		assert.doesNotMatch(html, /<div class="irz-container irz-shared"><\/div>/);
		assert.doesNotMatch(html, /id="good-to-know"/);
	});

	test("a closed studio offers no booking link, and says so", () => {
		const html = homeHtml(irezumi({}, CLOSED_STUDIO));
		assertSafePage(html);
		assert.doesNotMatch(html, /href="\/book"/);
		assert.match(html, /Not taking new inquiries right now/);
	});

	test("a long name wraps in the header (clamped there) and the hero", () => {
		const name = `${"Shree Ganesh Tattoo and Fine Line Atelier ".repeat(3)}श्री गणेश`;
		const html = homeHtml(irezumi({}, { ...STUDIO, name }));
		assertSafePage(html);
		assert.match(html, /<span class="brand-name" dir="auto">Shree Ganesh/);
		assert.match(css, /\.irz-brand \.brand-name[^{]*\{[^}]*line-clamp: 2/);
		assert.match(css, /\.irz-brand \{[^}]*overflow-wrap: anywhere/);
	});

	test("the footer shows the studio's own hours and the Good to know section is the shared one", () => {
		const html = homeHtml(irezumi({}, GOOD_TO_KNOW_STUDIO));
		assertSafePage(html);
		assert.match(html, /<dl class="irz-footer-hours">/);
		assert.match(html, /id="good-to-know"/);
	});
});

describe("Irezumi's pieces without a page of their own", () => {
	const idless = () => {
		const base = galleryPage(3);
		return {
			...base,
			data: base.data.map(({ id: _id, ...photo }) => photo),
		} as unknown as typeof base;
	};

	test("open the shared viewer from a button its title names, on the gallery and the home page", () => {
		const gallery = renderToStaticMarkup(
			createElement(ThemedWorkPage, {
				data: workPageData(
					irezumi(),
					[SITA, ARJUN],
					idless(),
					{},
					ORIGIN,
					IMAGE_ORIGIN,
				),
			}),
		);
		assertSafePage(gallery);
		assertUniqueIds(gallery);
		assert.equal(
			gallery.match(/<button type="button" class="irz-piece-link"/g)?.length,
			3,
		);
		assert.equal(gallery.match(/<dialog /g)?.length, 3);
		const home = homeHtml(irezumi(), [SITA, ARJUN], idless());
		assertSafePage(home);
		assertUniqueIds(home);
		assert.match(home, /<button type="button" class="irz-piece-link"/);
	});
});

describe("Irezumi's artist pages", () => {
	const portfolio = {
		page: galleryPage(3),
		search: {},
	};

	function artistHtml(
		artists: Artist[],
		read: typeof portfolio | undefined = portfolio,
		studio = irezumi(),
	) {
		const data = artistPageData(
			studio,
			artists,
			"sita",
			ORIGIN,
			IMAGE_ORIGIN,
			read,
		);
		assert.ok(data);
		return renderToStaticMarkup(createElement(ThemedArtistPage, { data }));
	}

	test("a signature piece leads, the name is the h1, and the whole portfolio follows", () => {
		const html = artistHtml([SITA, ARJUN]);
		assertSafePage(html);
		assertUniqueIds(html);
		const lead = /<img class="irz-artist-lead-photo"[^>]*>/.exec(html)?.[0];
		assert.ok(lead);
		assert.match(lead, /w1\.320-640-1280\.jpg/);
		assert.match(html, />Signature piece</);
		assert.match(
			html,
			/<h1 class="irz-artist-title" dir="auto">Sita Rai<\/h1>/,
		);
		assert.match(html, /id="work"/);
		assert.equal(html.match(/class="irz-piece"/g)?.length, 3);
		assert.match(html, /aria-current="true"[^>]*>Artists</);
		assert.match(html, /href="\/artists"/);
	});

	test("without work the portrait leads; with neither, the name stands alone", () => {
		const noWork = artistHtml([SITA, ARJUN], {
			page: null,
			search: {},
		} as never);
		assertSafePage(noWork);
		assert.match(noWork, /<img class="irz-artist-lead-photo"[^>]*sita/i);
		assert.doesNotMatch(noWork, /Signature piece/);
		assert.match(noWork, /No portfolio photos to show yet\./);
		const bare = artistHtml([{ ...SITA, photo: null }, ARJUN], {
			page: null,
			search: {},
		} as never);
		assertSafePage(bare);
		assert.match(bare, /irz-artist-grid irz-artist-solo/);
	});

	test("a closed artist in an open studio: the invitation says who is closed and where the request goes", () => {
		const data = artistPageData(
			irezumi(),
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
		assert.match(html, /Books open in March\./);
		const invite = html.slice(html.indexOf('id="inquiry"'));
		assert.match(
			invite,
			/<bdi>अर्जुन थापा<\/bdi> isn&#x27;t taking new work right now\. A request from here goes to <bdi>Black Needle<\/bdi>\./,
		);
		assert.match(invite, /href="\/book">Request a session</);
		assert.doesNotMatch(html, /href="\/book\?artist=arjun"/);
	});

	test("a closed studio: no booking link anywhere on an artist's page, and the closed words", () => {
		const data = artistPageData(
			irezumi({}, CLOSED_STUDIO),
			[{ ...SITA, acceptingInquiries: false }, ARJUN],
			"sita",
			ORIGIN,
			IMAGE_ORIGIN,
		);
		assert.ok(data);
		const html = renderToStaticMarkup(
			createElement(ThemedArtistPage, { data }),
		);
		assertSafePage(html);
		assert.doesNotMatch(html, /href="\/book/);
		assert.match(html, /isn&#x27;t taking new inquiries right now/);
	});

	test("the directory lists every artist as one link each, with a filter only when it narrows", () => {
		const data = artistsPageData(
			irezumi(),
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
		assert.match(html, /<h1 class="irz-page-title">The artists<\/h1>/);
		assert.equal(html.match(/class="irz-artist-entry"/g)?.length, 2);
		assert.match(
			html,
			/<a class="irz-artist-link" href="\/artists\/sita">Sita Rai<\/a>/,
		);
		assert.equal(html.match(/class="irz-preview"/g)?.length, 3);
		assert.match(html, /id="inquiry"/);
	});

	test("a lone artist: the home page names the section for one", () => {
		const html = homeHtml(irezumi(), [SITA]);
		assertSafePage(html);
		assert.match(
			html,
			/<h2 id="artists-title" class="irz-section-title">The artist<\/h2>/,
		);
	});

	test("an empty directory says so and invents no one", () => {
		const data = artistsPageData(irezumi(), [], {}, ORIGIN, IMAGE_ORIGIN);
		const html = renderToStaticMarkup(
			createElement(ThemedArtistsPage, { data }),
		);
		assertSafePage(html);
		assert.match(html, /No artists to show here yet\./);
		assert.doesNotMatch(html, /irz-artist-entry/);
	});
});

describe("Irezumi's gallery and tattoo pages", () => {
	test("every piece whole, each one link to its page, with the API's filters as links", () => {
		const data = workPageData(
			irezumi(),
			[SITA, ARJUN],
			galleryPage(4),
			{},
			ORIGIN,
			IMAGE_ORIGIN,
		);
		const html = renderToStaticMarkup(createElement(ThemedWorkPage, { data }));
		assertSafePage(html);
		assertUniqueIds(html);
		assert.match(html, /<h1 class="irz-page-title">The gallery<\/h1>/);
		assert.equal(html.match(/class="irz-piece-link"/g)?.length, 4);
		assert.match(html, new RegExp(`href="/gallery/${photoId(1)}"`));
		assert.match(html, /href="\/gallery\?style=fine-line"/);
		assert.match(html, /href="\/gallery\?healed=1"/);
		// The first piece loads at once; the rest lazily.
		const [first = "", second = ""] =
			html.match(/<img class="irz-piece-photo"[^>]*>/g) ?? [];
		assert.match(first, /loading="eager"/);
		assert.match(second, /loading="lazy"/);
		assert.match(pagesCss, /\.irz-piece-photo \{[^}]*object-fit: contain/);
	});

	test("an empty gallery says so; a filtered one offers the way back", () => {
		const empty = workPageData(
			irezumi(),
			[SITA],
			null,
			{},
			ORIGIN,
			IMAGE_ORIGIN,
		);
		const html = renderToStaticMarkup(
			createElement(ThemedWorkPage, { data: empty }),
		);
		assertSafePage(html);
		assert.match(html, /No photos to show yet\./);
		const filtered = workPageData(
			irezumi(),
			[SITA],
			galleryPage(0, { filters: { styles: [], healed: false } }),
			{ style: "fine-line" },
			ORIGIN,
			IMAGE_ORIGIN,
		);
		const filteredHtml = renderToStaticMarkup(
			createElement(ThemedWorkPage, { data: filtered }),
		);
		assert.match(filteredHtml, /No pieces match these filters\./);
		assert.match(filteredHtml, /href="\/gallery">Show every piece</);
	});

	test("a tattoo's page: the piece large and whole, its facts, its artist and the similar request", () => {
		const data = artworkPageData(
			irezumi(),
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
		assert.match(html, /class="irz-artwork-figure"/);
		assert.match(html, /<img class="artwork-photo"[^>]*fetchPriority="high"/);
		assert.match(html, /<h1 class="irz-artwork-title user-text"/);
		assert.match(html, />Healed</);
		assert.match(html, /Request a similar tattoo/);
		assert.match(html, /About the artist/);
		assert.match(html, /aria-current="page"[^>]*>Gallery</);
		// The piece is 4:3: its width is capped by 82vh times 4/3.
		assert.match(html, /min\(50\.67rem, calc\(82vh \* 1\.34\), 80rem\)/);
	});

	test("nobody takes new work: a tattoo's page asks for nothing similar", () => {
		const data = artworkPageData(
			irezumi({}, CLOSED_STUDIO),
			[{ ...SITA, acceptingInquiries: false }, ARJUN],
			galleryPage(1).data[0],
			[null, null, null],
			ORIGIN,
			IMAGE_ORIGIN,
		);
		assert.ok(data);
		assert.equal(data.similar, null);
		const html = renderToStaticMarkup(
			createElement(ThemedArtworkPage, { data }),
		);
		assertSafePage(html);
		assert.doesNotMatch(html, /Request a similar tattoo|href="\/book/);
	});
});

describe("Irezumi carries the shared pages: booking, flash and information", () => {
	test("/book: the shared flow under Irezumi's opening, whose h1 names the form", () => {
		const data = requestPageData(
			irezumi(),
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
			/<h1 id="inquiry-title" class="irz-page-title">Request a session<\/h1>/,
		);
		assert.match(
			html,
			/<main id="main" tabindex="-1" class="irz-main irz-book">/,
		);
		// The header has no booking button on the booking page itself.
		assert.doesNotMatch(html, /irz-header-cta/);
	});

	test("/flash and /about render inside Irezumi's shell", () => {
		const flash = flashPageData(
			irezumi(),
			[SITA, ARJUN],
			EMPTY_FLASH_PAGE,
			{},
			ORIGIN,
			IMAGE_ORIGIN,
		);
		const flashHtml = renderToStaticMarkup(
			createElement(ThemedFlashPage, { data: flash }),
		);
		assertSafePage(flashHtml);
		assert.match(flashHtml, /<header class="irz-header">/);
		const about = infoPageData(
			"about",
			irezumi(),
			[SITA, ARJUN],
			ORIGIN,
			IMAGE_ORIGIN,
		);
		assert.ok(about);
		const aboutHtml = renderToStaticMarkup(
			createElement(ThemedInfoPage, { data: about }),
		);
		assertSafePage(aboutHtml);
		assert.match(aboutHtml, /<footer class="irz-footer">/);
		assert.match(aboutHtml, /aria-current="page"[^>]*>About</);
	});
});

describe("the other themes are unchanged by Irezumi", () => {
	test("Ink Noir and Stencil & Ink keep their own shells", () => {
		const noir = homeHtml(
			withStorefront({ ...DEFAULT_STOREFRONT, theme: "ink-noir" }),
		);
		assert.match(noir, /class="ink-header"/);
		assert.doesNotMatch(noir, /irz-/);
		const stencil = homeHtml(withStorefront(DEFAULT_STOREFRONT));
		assert.match(stencil, /class="site-bar"/);
		assert.doesNotMatch(stencil, /irz-/);
	});
});
