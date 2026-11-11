import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
	IREZUMI_SCHEME,
	IREZUMI_THEME_COLOR,
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
 * Irezumi (src/studio/theme/irezumi/): a light editorial theme. These pin
 * that it is registered end to end (key, sections, <html> class, scheme,
 * theme colour, stylesheet), that a studio's accent is checked against its
 * own two surfaces, and that each page renders the studio's own data in
 * Irezumi's frame, with sparse data handled without inventing anything.
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
	const tokens = tokensOf(":root.theme-irezumi");

	test("the scheme's paper, ink, muted ink and raised surface are the stylesheet's", () => {
		assert.equal(tokens.get("--paper"), IREZUMI_SCHEME.paper);
		assert.equal(tokens.get("--ink"), IREZUMI_SCHEME.ink);
		assert.equal(tokens.get("--ink-muted"), IREZUMI_SCHEME.inkMuted);
		assert.deepEqual(IREZUMI_SCHEME.surfaces, [tokens.get("--paper-raised")]);
		assert.equal(tokens.get("--on-stencil"), IREZUMI_SCHEME.paper);
	});

	test("the vermilion's tokens are what a studio's own accent would get here", () => {
		const accent = tokens.get("--stencil");
		assert.equal(accent, "#b3321d");
		assert.deepEqual(accentTokens(accent as string, IREZUMI_SCHEME), {
			stencil: accent,
			stencilStrong: tokens.get("--stencil-strong"),
			stencilWash: tokens.get("--stencil-wash"),
		});
	});

	test("text, the accent and control borders read on the paper and the raised surface", () => {
		for (const surface of [
			IREZUMI_SCHEME.paper,
			...(IREZUMI_SCHEME.surfaces ?? []),
		]) {
			for (const name of [
				"--ink",
				"--ink-muted",
				"--stencil",
				"--stencil-strong",
			]) {
				const color = tokens.get(name) as string;
				assert.ok(
					contrastRatio(color, surface) >= 4.5,
					`${name} on ${surface}`,
				);
			}
			const border = tokens.get("--line-strong") as string;
			assert.ok(contrastRatio(border, surface) >= 3, "--line-strong");
		}
		assert.ok(
			contrastRatio(IREZUMI_SCHEME.paper, tokens.get("--stencil") as string) >=
				4.5,
			"text on the accent",
		);
	});

	test("the theme is light whatever the device prefers, loads nothing, and is imported", () => {
		assert.equal(css.match(/color-scheme:\s*light/g)?.length, 1);
		for (const sheet of [css, pagesCss]) {
			assert.doesNotMatch(sheet, /url\(|@import/);
		}
		assert.match(appCss, /@import '\.\/studio\/theme\/irezumi\/styles\.css';/);
		assert.match(appCss, /@import '\.\/studio\/theme\/irezumi\/pages\.css';/);
		// shadcn's `dark:` never applies under the light theme, even on a dark device.
		assert.match(
			appCss,
			/&:not\(:where\(\.theme-irezumi, \.theme-irezumi \*\)\)/,
		);
	});

	test("every rule is scoped: the theme's class or an irz- class", () => {
		for (const sheet of [css, pagesCss]) {
			const body = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
			for (const match of body.matchAll(/(^|})\s*([^{}@]+)\{/g)) {
				for (const selector of match[2].split(",")) {
					const trimmed = selector.trim();
					if (trimmed === "" || /^(from|to|\d+%)$/.test(trimmed)) continue;
					assert.match(
						trimmed,
						/theme-irezumi|\.irz-/,
						`unscoped selector: ${trimmed}`,
					);
				}
			}
		}
	});
});

describe("Irezumi's registration", () => {
	test("its sections are every theme's", () => {
		assert.deepEqual(THEME_SECTIONS.irezumi, THEME_SECTIONS["ink-noir"]);
	});

	test("THEME_HTML: its class, one light scheme and its paper as the browser's colour", () => {
		assert.equal(IREZUMI_CLASS, "theme-irezumi");
		assert.deepEqual(THEME_HTML.irezumi, {
			className: IREZUMI_CLASS,
			scheme: IREZUMI_SCHEME,
			themeColors: [{ content: IREZUMI_THEME_COLOR }],
		});
		assert.equal(IREZUMI_THEME_COLOR, "#f6f1e7");
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

describe("brandingCss for Irezumi: one light scheme, checked on both surfaces", () => {
	const config = (values: Partial<ThemeConfig>): ThemeConfig => ({
		...parseThemeConfig({ theme: "irezumi" }, null),
		...values,
	});

	test("without a brand there is no <style>", () => {
		assert.equal(brandingCss(config({})), null);
	});

	test("an accent that reads on the paper and the raised surface is set on the class, as it is", () => {
		const out = brandingCss(config({ accent: "#0f5e58" }));
		assert.ok(out);
		assert.ok(isSafeCss(out));
		assert.doesNotMatch(out, /@media/);
		assert.match(out, /^html:root\.theme-irezumi\{--stencil:#0f5e58;/);
	});

	test("an accent that reads on the paper but not on the raised surface keeps the vermilion", () => {
		// #0f766e passes the platform's check on Stencil & Ink's paper (4.95:1)
		// and Irezumi's paper (4.86:1), but not its raised surface (4.37:1).
		const paperOnly = "#0f766e";
		assert.ok(contrastRatio(paperOnly, IREZUMI_SCHEME.paper) >= 4.5);
		assert.ok(
			contrastRatio(paperOnly, (IREZUMI_SCHEME.surfaces ?? [])[0]) < 4.5,
		);
		assert.equal(brandingCss(config({ accent: paperOnly })), null);
	});

	test("the dark accent is not used: the page is never dark", () => {
		assert.equal(brandingCss(config({ accentDark: "#fca5a5" })), null);
		assert.equal(
			brandingCss(config({ accent: "#fca5a5", accentDark: "#fca5a5" })),
			null,
			"a pale accent that can't be read on paper keeps the vermilion",
		);
	});

	test("the studio's font still applies", () => {
		assert.match(
			brandingCss(config({ font: "serif" })) ?? "",
			/html:root\{--display-face:/,
		);
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

	test("the cover leads when the studio has one, and is never repeated as a piece", () => {
		const html = homeHtml(
			irezumi({}, { ...STUDIO, cover: COVER_SIZED }),
			[SITA, ARJUN],
			work,
		);
		assert.match(html, /<img class="irz-hero-photo"[^>]*cover\.jpg/);
		assert.doesNotMatch(html, /Featured piece/);
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
		assert.match(
			html,
			/Work will appear here as soon as the studio adds photos\./,
		);
		assert.doesNotMatch(html, /View the gallery|id="artists"|irz-intro/);
		assert.doesNotMatch(html, /irz-footer-(contact|visit|follow)/);
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
