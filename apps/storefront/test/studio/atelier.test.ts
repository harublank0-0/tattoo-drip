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
import { atelierHome } from "../../src/studio/theme/atelier/home-view.ts";
import {
	ATELIER_CLASS,
	ATELIER_SCHEME,
	ATELIER_THEME_COLOR,
} from "../../src/studio/theme/atelier/theme.ts";
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
 * Atelier (src/studio/theme/atelier/): a light editorial theme. These pin
 * that it is registered end to end (key, sections, <html> class, scheme,
 * theme colour, stylesheet), that a studio's accent is checked against its
 * own two surfaces, and that each page renders the studio's own data in
 * Atelier's frame, with sparse data handled without inventing anything.
 */

const css = readFileSync(
	new URL("../../src/studio/theme/atelier/styles.css", import.meta.url),
	"utf8",
);
const pagesCss = readFileSync(
	new URL("../../src/studio/theme/atelier/pages.css", import.meta.url),
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

const atelier = (storefront: object = {}, studio: Studio = STUDIO): Studio =>
	withStorefront(
		{ ...DEFAULT_STOREFRONT, theme: "atelier", ...storefront },
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

describe("Atelier's palette (theme.ts and styles.css agree)", () => {
	const tokens = tokensOf(":root.theme-atelier");

	test("the scheme's paper, ink, muted ink, raised paper and mat are the stylesheet's", () => {
		assert.equal(tokens.get("--paper"), ATELIER_SCHEME.paper);
		assert.equal(tokens.get("--ink"), ATELIER_SCHEME.ink);
		assert.equal(tokens.get("--ink-muted"), ATELIER_SCHEME.inkMuted);
		assert.deepEqual(ATELIER_SCHEME.surfaces, [
			tokens.get("--paper-raised"),
			tokens.get("--atl-mat"),
		]);
		assert.equal(tokens.get("--on-stencil"), ATELIER_SCHEME.paper);
	});

	test("the bronze's tokens are what a studio's own accent would get here", () => {
		const accent = tokens.get("--stencil");
		assert.equal(accent, "#7a5a24");
		assert.deepEqual(accentTokens(accent as string, ATELIER_SCHEME), {
			stencil: accent,
			stencilStrong: tokens.get("--stencil-strong"),
			stencilWash: tokens.get("--stencil-wash"),
		});
	});

	test("text, the accent and control borders read on the paper, the raised paper and the mat; the brass is never text", () => {
		for (const surface of [
			ATELIER_SCHEME.paper,
			...(ATELIER_SCHEME.surfaces ?? []),
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
			contrastRatio(ATELIER_SCHEME.paper, tokens.get("--stencil") as string) >=
				4.5,
			"text on the accent",
		);
		// The brass is decoration: no rule ever sets it as a text colour.
		for (const sheet of [css, pagesCss]) {
			assert.doesNotMatch(sheet, /(?:^|[\s;{])color:\s*var\(--atl-brass\)/);
		}
	});

	test("the theme is light whatever the device prefers, loads only its own fonts, and is imported", () => {
		assert.equal(css.match(/color-scheme:\s*light/g)?.length, 1);
		assert.doesNotMatch(pagesCss, /url\(|@import/);
		assert.doesNotMatch(css, /@import/);
		const urls = Array.from(css.matchAll(/url\('([^']+)'\)/g), (m) => m[1]);
		assert.equal(urls.length, 4);
		for (const href of urls) {
			assert.match(
				href,
				/^\.\.\/\.\.\/\.\.\/assets\/fonts\/bodoni-moda\/bodoni-moda-[a-z-]+-(500-normal|400-italic)\.woff2$/,
			);
			const file = new URL(
				`../../src/studio/theme/atelier/${href}`,
				import.meta.url,
			);
			const bytes = readFileSync(file);
			assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", href);
			assert.ok(bytes.length < 40 * 1024, `${href} is ${bytes.length} bytes`);
		}
		assert.match(appCss, /@import '\.\/studio\/theme\/atelier\/styles\.css';/);
		assert.match(appCss, /@import '\.\/studio\/theme\/atelier\/pages\.css';/);
		// shadcn's `dark:` never applies under the light theme, even on a dark device.
		assert.match(
			appCss,
			/&:not\(:where\([^)]*\.theme-atelier, \.theme-atelier \*\)\)/,
		);
	});

	test("every rule is scoped: it starts at the theme's class or an atl- class", () => {
		const scoped =
			/^(:root\.theme-atelier\b|:root:has\(\.chat-float\) \.atl-|\.atl-)/;
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
			".atl-plate-photo",
			".atl-piece-photo",
			".atl-artwork-figure .artwork-photo",
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

describe("Atelier's registration", () => {
	test("its sections are every theme's", () => {
		assert.deepEqual(THEME_SECTIONS.atelier, THEME_SECTIONS["ink-noir"]);
	});

	test("THEME_HTML: its class, one light scheme and its paper as the browser's colour", () => {
		assert.equal(ATELIER_CLASS, "theme-atelier");
		assert.deepEqual(THEME_HTML.atelier, {
			className: ATELIER_CLASS,
			scheme: ATELIER_SCHEME,
			themeColors: [{ content: ATELIER_THEME_COLOR }],
		});
		assert.equal(ATELIER_THEME_COLOR, "#f3f1ed");
	});

	test("the matched page is Atelier for a studio that picked it, but never the deposit page", () => {
		const root = { routeId: "__root__", loaderData: atelier() };
		assert.equal(matchedThemeKey([root, { routeId: "/" }]), "atelier");
		assert.equal(
			matchedThemeKey([root, { routeId: "/gallery/$photo" }]),
			"atelier",
		);
		assert.equal(
			matchedThemeKey([root, { routeId: "/deposit" }]),
			"stencil-and-ink",
		);
	});

	test("its pages are Atelier's own, with the shared flash and informational pages", () => {
		const theme = THEMES.atelier;
		assert.equal(theme.Shell.name, "AtelierShell");
		assert.equal(theme.StudioPage.name, "AtelierStudioPage");
		assert.equal(theme.ArtistsPage.name, "AtelierArtistsPage");
		assert.equal(theme.ArtistPage.name, "AtelierArtistPage");
		assert.equal(theme.WorkPage.name, "AtelierGalleryPage");
		assert.equal(theme.ArtworkPage.name, "AtelierArtworkPage");
		assert.equal(theme.RequestPage.name, "AtelierBookPage");
		assert.equal(theme.FlashPage, THEMES["stencil-and-ink"].FlashPage);
		assert.equal(theme.InfoPage, THEMES["stencil-and-ink"].InfoPage);
	});
});

describe("brandingCss for Atelier: one light scheme, checked on all three surfaces", () => {
	const config = (values: Partial<ThemeConfig>): ThemeConfig => ({
		...parseThemeConfig({ theme: "atelier" }, null),
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
		assert.match(out, /^html:root\.theme-atelier\{--stencil:#0f5e58;/);
	});

	test("an accent that reads on the paper but not on the raised paper keeps the bronze", () => {
		// #0f766e passes the platform's check on Stencil & Ink's paper (4.95:1)
		// and Atelier's paper, but not its raised paper.
		const paperOnly = "#0f766e";
		assert.ok(contrastRatio(paperOnly, ATELIER_SCHEME.paper) >= 4.5);
		assert.ok(
			contrastRatio(paperOnly, (ATELIER_SCHEME.surfaces ?? [])[0]) < 4.5,
		);
		assert.equal(brandingCss(config({ accent: paperOnly })), null);
	});

	test("the dark accent is not used: the page is never dark", () => {
		assert.equal(brandingCss(config({ accentDark: "#fca5a5" })), null);
		assert.equal(
			brandingCss(config({ accent: "#fca5a5", accentDark: "#fca5a5" })),
			null,
			"a pale accent that can't be read on paper keeps the bronze",
		);
	});

	test("Bodoni is the theme's own face: the default font keeps it, and only an Atelier page preloads it", () => {
		assert.equal(brandingCss(config({ font: "eczar" })), null);
		assert.match(
			tokensOf(":root.theme-atelier").get("--display-face") ?? "",
			/^'Bodoni Moda', 'Noto Serif Devanagari', 'Noto Serif', Didot, Georgia, 'Times New Roman', serif$/,
		);
		const root = readFileSync(
			new URL("../../src/routes/__root.tsx", import.meta.url),
			"utf8",
		);
		assert.match(
			root,
			/import bodoniLatin from "\.\.\/assets\/fonts\/bodoni-moda\/bodoni-moda-latin-500-normal\.woff2\?url";/,
		);
		assert.match(root, /matchedThemeKey\(matches\) === "atelier"/);
		const licence = readFileSync(
			new URL("../../src/assets/fonts/bodoni-moda/OFL.txt", import.meta.url),
			"utf8",
		);
		assert.match(licence, /SIL Open Font License, Version 1\.1/);
		assert.match(licence, /Bodoni Moda Project Authors/);
	});

	test("the studio's font still applies, over the theme's own", () => {
		assert.match(
			brandingCss(config({ font: "serif" })) ?? "",
			/html:root\.theme-atelier\{--display-face:/,
		);
	});
});

describe("Atelier's home page", () => {
	const work = galleryPage(8);

	test("the shell: skip link, header with nav and booking, <main id=main>, footer", () => {
		const html = homeHtml(atelier(), [SITA, ARJUN], work);
		assertSafePage(html);
		assertUniqueIds(html);
		assert.match(html, /<a class="atl-skip" href="#main">/);
		assert.match(html, /<header class="atl-header">/);
		assert.match(
			html,
			/<main id="main" tabindex="-1" class="atl-main atl-home">/,
		);
		assert.match(html, /<footer class="atl-footer">/);
		assert.match(html, /class="atl-menu-button"[^>]*aria-expanded="false"/);
		assert.match(html, /<a[^>]*aria-current="page"[^>]*>Home<\/a>/);
		assert.doesNotMatch(html, /class="(site-bar|ink-header)"/);
	});

	test("the name is the h1, the booking action is beside it, and the strongest piece leads whole", () => {
		const html = homeHtml(atelier(), [SITA, ARJUN], work);
		assert.match(
			html,
			/<h1 class="atl-hero-name" dir="auto">Black Needle<\/h1>/,
		);
		assert.match(
			html,
			/<div class="atl-hero-actions"><a class="action action-primary atl-cta" href="\/book">Request a session<\/a>/,
		);
		assert.match(html, /href="\/gallery">View the collection</);
		const lead = /<img class="atl-plate-photo"[^>]*>/.exec(html)?.[0];
		assert.ok(lead, "a lead photo");
		assert.match(lead, /loading="eager"/);
		assert.match(lead, /fetchPriority="high"/);
		assert.match(lead, /w1\.320-640-1280\.jpg/);
		assert.match(html, />From the collection</);
		assert.match(html, /<figure class="atl-plate atl-hero-plate">/);
	});

	test("the cover leads when the studio has one", () => {
		const html = homeHtml(
			atelier({}, { ...STUDIO, cover: COVER_SIZED }),
			[SITA, ARJUN],
			work,
		);
		assertSafePage(html, { brandImages: true });
		assert.match(html, /<img class="atl-plate-photo"[^>]*cover\.jpg/);
		assert.doesNotMatch(html, /From the collection/);
		// The plate is at most 52rem wide; a 2:1 cover is capped by 78vh times 2.
		assert.match(
			html,
			/sizes="\(min-width: 55rem\) min\(52rem, calc\(78vh \* 2\), 100rem\)/,
		);
	});

	test("without a cover the largest piece leads and is not repeated in the selected work", () => {
		const data = studioPageData(
			atelier(),
			[SITA, ARJUN],
			ORIGIN,
			IMAGE_ORIGIN,
			work,
		);
		const home = atelierHome(data);
		assert.equal(home.lead?.source, "work");
		assert.ok(home.selected.every((photo) => photo.src !== home.lead?.src));
		assert.equal(home.selected.length, 6);
	});

	test("the sections follow the studio's Page look order, and hidden ones are left out", () => {
		const html = homeHtml(
			atelier({
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
		const hidden = homeHtml(atelier({ sections: [{ type: "inquiry" }] }));
		assert.doesNotMatch(hidden, /id="artists"|id="recent-work"/);
	});

	test("a sparse studio: no photos, no artists, no intro, no contacts; nothing is made up", () => {
		const html = homeHtml(atelier({}, EMPTY_STUDIO), [], null);
		assertSafePage(html);
		assertUniqueIds(html);
		assert.doesNotMatch(html, /<img/);
		assert.match(html, /class="atl-hero-ornament" aria-hidden="true"/);
		assert.match(html, /No pieces to show here yet\./);
		assert.doesNotMatch(html, /View the collection|id="artists"|atl-intro/);
		assert.doesNotMatch(html, /atl-footer-(contact|visit|follow)/);
		// Good to know is empty: no empty wrapper for it either.
		assert.doesNotMatch(html, /<div class="atl-container atl-shared"><\/div>/);
		assert.doesNotMatch(html, /id="good-to-know"/);
	});

	test("a closed studio offers no booking link, and says so", () => {
		const html = homeHtml(atelier({}, CLOSED_STUDIO));
		assertSafePage(html);
		assert.doesNotMatch(html, /href="\/book"/);
		assert.match(html, /Not taking new inquiries right now/);
	});

	test("a long name wraps in the header (clamped there) and the hero", () => {
		const name = `${"Shree Ganesh Tattoo and Fine Line Atelier ".repeat(3)}श्री गणेश`;
		const html = homeHtml(atelier({}, { ...STUDIO, name }));
		assertSafePage(html);
		assert.match(html, /<span class="brand-name" dir="auto">Shree Ganesh/);
		assert.match(css, /\.atl-brand \.brand-name[^{]*\{[^}]*line-clamp: 2/);
		assert.match(css, /\.atl-brand \{[^}]*overflow-wrap: anywhere/);
	});

	test("the footer shows the studio's own hours and the Good to know section is the shared one", () => {
		const html = homeHtml(atelier({}, GOOD_TO_KNOW_STUDIO));
		assertSafePage(html);
		assert.match(html, /<dl class="atl-footer-hours">/);
		assert.match(html, /id="good-to-know"/);
	});
});

describe("Atelier's pieces without a page of their own", () => {
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
					atelier(),
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
			gallery.match(/<button type="button" class="atl-piece-link"/g)?.length,
			3,
		);
		assert.equal(gallery.match(/<dialog /g)?.length, 3);
		const home = homeHtml(atelier(), [SITA, ARJUN], idless());
		assertSafePage(home);
		assertUniqueIds(home);
		assert.match(home, /<button type="button" class="atl-piece-link"/);
	});
});

describe("Atelier's artist pages", () => {
	const portfolio = {
		page: galleryPage(3),
		search: {},
	};

	function artistHtml(
		artists: Artist[],
		read: typeof portfolio | undefined = portfolio,
		studio = atelier(),
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

	test("the arch and the name open the page, the signature piece follows on its plate, then the numbered collection", () => {
		const html = artistHtml([SITA, ARJUN]);
		assertSafePage(html);
		assertUniqueIds(html);
		const arch = html.indexOf('class="atl-arch atl-arch-large"');
		const title = html.indexOf('<h1 class="atl-artist-title"');
		const plate = html.indexOf('<figure class="atl-plate atl-artist-lead">');
		assert.ok(
			arch > 0 && arch < title && title < plate,
			"arch, name, then the plate",
		);
		const lead = /<img class="atl-plate-photo"[^>]*>/.exec(html)?.[0];
		assert.ok(lead);
		assert.match(lead, /fetchPriority="high"/);
		assert.match(lead, /w1\.320-640-1280\.jpg/);
		assert.match(html, />Signature piece</);
		assert.match(
			html,
			/<h1 class="atl-artist-title" dir="auto">Sita Rai<\/h1>/,
		);
		assert.match(html, /id="work"/);
		assert.equal(html.match(/class="atl-piece"/g)?.length, 3);
		assert.match(
			html,
			/<span class="atl-piece-number" aria-hidden="true">No\. 01<\/span>/,
		);
		assert.match(html, /No\. 03</);
		assert.match(html, /aria-current="true"[^>]*>Artists</);
		assert.match(html, /href="\/artists"/);
	});

	test("without work there is no plate; without a portrait the arch holds the initial, never a made-up photo", () => {
		const noWork = artistHtml([SITA, ARJUN], {
			page: null,
			search: {},
		} as never);
		assertSafePage(noWork);
		assert.match(
			noWork,
			/<span class="atl-arch atl-arch-large"><img [^>]*sita/i,
		);
		assert.doesNotMatch(noWork, /Signature piece|atl-plate/);
		assert.match(noWork, /No portfolio photos to show yet\./);
		const bare = artistHtml([{ ...SITA, photo: null }, ARJUN], {
			page: null,
			search: {},
		} as never);
		assertSafePage(bare);
		assert.doesNotMatch(bare, /<img/);
		assert.match(
			bare,
			/<span class="atl-arch atl-arch-large atl-arch-initial" aria-hidden="true">S<\/span>/,
		);
	});

	test("a closed artist in an open studio: the invitation says who is closed and where the request goes", () => {
		const data = artistPageData(
			atelier(),
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
			atelier({}, CLOSED_STUDIO),
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
			atelier(),
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
		assert.match(html, /<h1 class="atl-page-title">The artists<\/h1>/);
		assert.equal(html.match(/class="atl-artist-entry"/g)?.length, 2);
		assert.match(
			html,
			/<a class="atl-artist-link" href="\/artists\/sita">Sita Rai<\/a>/,
		);
		// Each in an arch: the portrait, with its own description.
		assert.match(
			html,
			/<span class="atl-arch"><img [^>]*alt="Photo of Sita Rai"/,
		);
		assert.match(
			html,
			/<ul class="atl-artist-index" role="list" data-count="2">/,
		);
		assert.match(html, /id="inquiry"/);
	});

	test("a lone artist: the home page names the section for one", () => {
		const html = homeHtml(atelier(), [SITA]);
		assertSafePage(html);
		assert.match(
			html,
			/<h2 id="artists-title" class="atl-section-title">The artist<\/h2>/,
		);
	});

	test("an empty directory says so and invents no one", () => {
		const data = artistsPageData(atelier(), [], {}, ORIGIN, IMAGE_ORIGIN);
		const html = renderToStaticMarkup(
			createElement(ThemedArtistsPage, { data }),
		);
		assertSafePage(html);
		assert.match(html, /No artists to show here yet\./);
		assert.doesNotMatch(html, /atl-artist-entry/);
	});
});

describe("Atelier's gallery and tattoo pages", () => {
	test("every piece whole, each one link to its page, with the API's filters as links", () => {
		const data = workPageData(
			atelier(),
			[SITA, ARJUN],
			galleryPage(4),
			{},
			ORIGIN,
			IMAGE_ORIGIN,
		);
		const html = renderToStaticMarkup(createElement(ThemedWorkPage, { data }));
		assertSafePage(html);
		assertUniqueIds(html);
		assert.match(html, /<h1 class="atl-page-title">The collection<\/h1>/);
		assert.match(html, /aria-hidden="true">No\. 04</);
		assert.equal(html.match(/class="atl-piece-link"/g)?.length, 4);
		assert.match(html, new RegExp(`href="/gallery/${photoId(1)}"`));
		assert.match(html, /href="\/gallery\?style=fine-line"/);
		assert.match(html, /href="\/gallery\?healed=1"/);
		// The first piece loads at once; the rest lazily.
		const [first = "", second = ""] =
			html.match(/<img class="atl-piece-photo"[^>]*>/g) ?? [];
		assert.match(first, /loading="eager"/);
		assert.match(second, /loading="lazy"/);
		assert.match(pagesCss, /\.atl-piece-photo \{[^}]*object-fit: contain/);
	});

	test("an empty gallery says so; a filtered one offers the way back", () => {
		const empty = workPageData(
			atelier(),
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
			atelier(),
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
		assert.match(filteredHtml, /href="\/gallery">Show the whole collection</);
	});

	test("a tattoo's page: the piece large and whole, its facts, its artist and the similar request", () => {
		const data = artworkPageData(
			atelier(),
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
		assert.match(html, /<figure class="atl-plate atl-artwork-figure">/);
		assert.match(html, /<img class="artwork-photo"[^>]*fetchPriority="high"/);
		assert.match(html, /<h1 class="atl-artwork-title user-text"/);
		assert.match(html, />Healed</);
		assert.match(html, /Request a similar tattoo/);
		assert.match(html, /About the artist/);
		assert.match(html, /aria-current="page"[^>]*>Gallery</);
		// On the 52rem plate; the piece is 4:3, so its width is capped by 82vh times 4/3.
		assert.match(
			html,
			/\(min-width: 55rem\) min\(52rem, calc\(82vh \* 1\.34\), 80rem\)/,
		);
	});

	test("nobody takes new work: a tattoo's page asks for nothing similar", () => {
		const data = artworkPageData(
			atelier({}, CLOSED_STUDIO),
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

describe("Atelier carries the shared pages: booking, flash and information", () => {
	test("/book: the shared flow under Atelier's opening, whose h1 names the form", () => {
		const data = requestPageData(
			atelier(),
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
			/<h1 id="inquiry-title" class="atl-page-title">Request an appointment<\/h1>/,
		);
		assert.match(
			html,
			/<main id="main" tabindex="-1" class="atl-main atl-book">/,
		);
		// The header has no booking button on the booking page itself.
		assert.doesNotMatch(html, /atl-header-cta/);
	});

	test("/flash and /about render inside Atelier's shell", () => {
		const flash = flashPageData(
			atelier(),
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
		assert.match(flashHtml, /<header class="atl-header">/);
		const about = infoPageData(
			"about",
			atelier(),
			[SITA, ARJUN],
			ORIGIN,
			IMAGE_ORIGIN,
		);
		assert.ok(about);
		const aboutHtml = renderToStaticMarkup(
			createElement(ThemedInfoPage, { data: about }),
		);
		assertSafePage(aboutHtml);
		assert.match(aboutHtml, /<footer class="atl-footer">/);
		assert.match(aboutHtml, /aria-current="page"[^>]*>About</);
	});
});

describe("the other themes are unchanged by Atelier", () => {
	test("Ink Noir and Stencil & Ink keep their own shells", () => {
		const noir = homeHtml(
			withStorefront({ ...DEFAULT_STOREFRONT, theme: "ink-noir" }),
		);
		assert.match(noir, /class="ink-header"/);
		assert.doesNotMatch(noir, /atl-/);
		const stencil = homeHtml(withStorefront(DEFAULT_STOREFRONT));
		assert.match(stencil, /class="site-bar"/);
		assert.doesNotMatch(stencil, /atl-/);
	});
});
