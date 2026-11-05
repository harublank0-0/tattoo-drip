import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { Artist, Studio } from "@tattoo-drip/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isRouterClick } from "../../src/studio/components/router-anchor.tsx";
import { isAllowedHref } from "../../src/studio/links.ts";
import {
	artistPageData,
	flashPageData,
	requestPageData,
	studioPageData,
	workPageData,
} from "../../src/studio/loaders.ts";
import {
	moreNavItems,
	navItems,
	type ShellPage,
} from "../../src/studio/nav.ts";
import {
	accentTokens,
	brandingCss,
	isSafeCss,
} from "../../src/studio/theme/branding.ts";
import { contrastRatio } from "../../src/studio/theme/color.ts";
import {
	parseThemeConfig,
	SECTION_KEYS,
	type ThemeConfig,
} from "../../src/studio/theme/config.ts";
import { matchedThemeKey, THEME_HTML } from "../../src/studio/theme/html.ts";
import { InkNoirArtistPage } from "../../src/studio/theme/ink-noir/artist/artist-page.tsx";
import { InkNoirBookPage } from "../../src/studio/theme/ink-noir/book/book-page.tsx";
import { InkNoirArtworkPage } from "../../src/studio/theme/ink-noir/gallery/artwork-page.tsx";
import { InkNoirGalleryPage } from "../../src/studio/theme/ink-noir/gallery/gallery-page.tsx";
import { InkNoirStudioPage } from "../../src/studio/theme/ink-noir/home/home-page.tsx";
import {
	INK_NOIR_CLASS,
	INK_NOIR_SCHEME,
} from "../../src/studio/theme/ink-noir/theme.ts";
import {
	THEMES,
	ThemedArtistPage,
	ThemedFlashPage,
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
	ORIGIN,
	SITA,
	STUDIO,
} from "./fixtures.ts";
import { assertSafePage } from "./safety.ts";
import { IMAGE_ORIGIN, LOGO, withStorefront } from "./theme-fixtures.ts";

const css = readFileSync(
	new URL("../../src/studio/theme/ink-noir/styles.css", import.meta.url),
	"utf8",
);
const appCss = readFileSync(
	new URL("../../src/styles.css", import.meta.url),
	"utf8",
);

/** The custom properties a rule sets, by name. */
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

const inkNoir = (storefront: object = {}, studio: Studio = STUDIO): Studio =>
	withStorefront(
		{ ...DEFAULT_STOREFRONT, theme: "ink-noir", ...storefront },
		studio,
	);
const stencil = (studio: Studio = STUDIO): Studio =>
	withStorefront(DEFAULT_STOREFRONT, studio);

function studioHtml(studio: Studio, artists: Artist[] = [SITA, ARJUN]) {
	return renderToStaticMarkup(
		createElement(ThemedStudioPage, {
			data: studioPageData(studio, artists, ORIGIN, IMAGE_ORIGIN),
		}),
	);
}

function artistHtml(studio: Studio, slug = "sita") {
	const data = artistPageData(
		studio,
		[SITA, ARJUN],
		slug,
		ORIGIN,
		IMAGE_ORIGIN,
	);
	assert.ok(data);
	return renderToStaticMarkup(createElement(ThemedArtistPage, { data }));
}

function requestHtml(studio: Studio) {
	return renderToStaticMarkup(
		createElement(ThemedRequestPage, {
			data: requestPageData(studio, [SITA, ARJUN], {}, ORIGIN, IMAGE_ORIGIN),
		}),
	);
}

function workHtml(studio: Studio) {
	return renderToStaticMarkup(
		createElement(ThemedWorkPage, {
			data: workPageData(studio, [SITA, ARJUN], null, {}, ORIGIN, IMAGE_ORIGIN),
		}),
	);
}

function flashHtml(studio: Studio) {
	return renderToStaticMarkup(
		createElement(ThemedFlashPage, {
			data: flashPageData(
				studio,
				[SITA, ARJUN],
				EMPTY_FLASH_PAGE,
				{},
				ORIGIN,
				IMAGE_ORIGIN,
			),
		}),
	);
}

/** What a page renders inside <main>. */
const mainOf = (html: string) => {
	const match = /<main[^>]*>([\s\S]*)<\/main>/.exec(html);
	assert.ok(match, "a <main>");
	return match[1];
};
const ids = (html: string) =>
	Array.from(html.matchAll(/ id="([^"]*)"/g), (match) => match[1]);
const currentLinks = (html: string) =>
	Array.from(
		html.matchAll(/<a [^>]*aria-current="(page|true)"[^>]*>([^<]*)<\/a>/g),
		(match) => `${match[2]}=${match[1]}`,
	);

describe("Ink Noir's palette (theme.ts and styles.css agree)", () => {
	const tokens = tokensOf(":root.theme-ink-noir");

	test("the scheme's paper, ink and muted ink are the stylesheet's", () => {
		assert.equal(tokens.get("--paper"), INK_NOIR_SCHEME.paper);
		assert.equal(tokens.get("--ink"), INK_NOIR_SCHEME.ink);
		assert.equal(tokens.get("--ink-muted"), INK_NOIR_SCHEME.inkMuted);
		assert.equal(tokens.get("--on-stencil"), INK_NOIR_SCHEME.paper);
	});

	test("the accent tokens are what a studio's own accent would get on this paper", () => {
		const accent = tokens.get("--stencil");
		assert.ok(accent);
		assert.deepEqual(accentTokens(accent, INK_NOIR_SCHEME), {
			stencil: accent,
			stencilStrong: tokens.get("--stencil-strong"),
			stencilWash: tokens.get("--stencil-wash"),
		});
	});

	test("text, the accent and control borders read on the paper and the raised surface", () => {
		const raised = tokens.get("--paper-raised");
		assert.ok(raised);
		for (const surface of [INK_NOIR_SCHEME.paper, raised]) {
			for (const name of ["--ink", "--ink-muted", "--stencil"]) {
				const color = tokens.get(name);
				assert.ok(color, name);
				assert.ok(
					contrastRatio(color, surface) >= 4.5,
					`${name} on ${surface}`,
				);
			}
			const border = tokens.get("--line-strong");
			assert.ok(border && contrastRatio(border, surface) >= 3, "--line-strong");
		}
		const accent = tokens.get("--stencil");
		assert.ok(accent);
		assert.ok(
			contrastRatio(INK_NOIR_SCHEME.paper, accent) >= 4.5,
			"text on the accent",
		);
	});

	test("the theme is dark whatever the device prefers, and loads nothing", () => {
		assert.equal(css.match(/color-scheme:\s*dark/g)?.length, 1);
		assert.doesNotMatch(css, /url\(|@import/);
		assert.match(appCss, /@import '\.\/studio\/theme\/ink-noir\/styles\.css';/);
		// shadcn's `dark:` follows the theme too, not only the device.
		assert.match(appCss, /&:where\(\.theme-ink-noir, \.theme-ink-noir \*\)/);
	});

	test("the html class the stylesheet keys on is the theme's", () => {
		assert.equal(INK_NOIR_CLASS, "theme-ink-noir");
		assert.equal(THEME_HTML["ink-noir"].className, INK_NOIR_CLASS);
	});

	test("motion answers prefers-reduced-motion", () => {
		const reduced = css.slice(
			css.indexOf("@media (prefers-reduced-motion: reduce)"),
		);
		assert.match(reduced, /\.ink-nav-list a::after/);
		assert.match(reduced, /\.ink-sheet/);
	});
});

describe("THEME_HTML: what a theme sets on <html> and in <head>", () => {
	test("Stencil & Ink adds no class and keeps its two theme colours", () => {
		assert.deepEqual(THEME_HTML["stencil-and-ink"], {
			className: null,
			scheme: null,
			themeColors: [
				{ content: "#f7f3ee", media: "(prefers-color-scheme: light)" },
				{ content: "#14110f", media: "(prefers-color-scheme: dark)" },
			],
		});
	});

	test("Ink Noir has its class, its one scheme and its paper as the browser's colour", () => {
		assert.equal(THEME_HTML["ink-noir"].scheme, INK_NOIR_SCHEME);
		assert.deepEqual(THEME_HTML["ink-noir"].themeColors, [
			{ content: INK_NOIR_SCHEME.paper },
		]);
	});
});

describe("matchedThemeKey: the theme of the matched page", () => {
	const root = (loaderData: unknown) => ({ routeId: "__root__", loaderData });

	test("is the root studio's theme", () => {
		assert.equal(
			matchedThemeKey([root(inkNoir()), { routeId: "/" }]),
			"ink-noir",
		);
		assert.equal(
			matchedThemeKey([root(stencil()), { routeId: "/" }]),
			"stencil-and-ink",
		);
	});

	test("is the default without a studio (a failed read) or matches", () => {
		assert.equal(matchedThemeKey([]), "stencil-and-ink");
		assert.equal(matchedThemeKey([root(undefined)]), "stencil-and-ink");
	});

	test("is the default on the deposit page, which is not themable", () => {
		assert.equal(
			matchedThemeKey([root(inkNoir()), { routeId: "/deposit" }]),
			"stencil-and-ink",
		);
	});
});

describe("brandingCss for Ink Noir: one scheme, no media query", () => {
	const config = (values: Partial<ThemeConfig>): ThemeConfig => ({
		...parseThemeConfig({ theme: "ink-noir" }, null),
		...values,
	});

	test("Ink Noir without a brand writes no <style>", () => {
		assert.equal(brandingCss(config({})), null);
	});

	test("an accent is checked against Ink Noir's paper and set on its class", () => {
		const out = brandingCss(config({ accent: "#b91c1c" }));
		assert.ok(out);
		assert.ok(isSafeCss(out));
		assert.doesNotMatch(out, /@media/);
		assert.match(out, /^html:root\.theme-ink-noir\{--stencil:(#[0-9a-f]{6});/);
		const accent = /--stencil:(#[0-9a-f]{6})/.exec(out)?.[1];
		assert.ok(accent);
		// #b91c1c is too dark on this paper: it is lightened until it reads.
		assert.notEqual(accent, "#b91c1c");
		assert.ok(contrastRatio(accent, INK_NOIR_SCHEME.paper) >= 4.5);
	});

	test("the dark accent is used as it is when it reads on the paper", () => {
		assert.equal(
			brandingCss(
				config({ accent: "#b91c1c", accentDark: "#fca5a5" }),
			)?.startsWith("html:root.theme-ink-noir{--stencil:#fca5a5;"),
			true,
		);
	});

	test("the studio's font still applies", () => {
		assert.match(
			brandingCss(config({ font: "serif" })) ?? "",
			/--display-face:/,
		);
	});
});

describe("navItems: the pages a theme's navigation lists", () => {
	const all = [...SECTION_KEYS];

	test("every href is allowed, and each page marks its own item", () => {
		const expected: Record<ShellPage, string[]> = {
			home: ["Home=page"],
			artists: ["Artists=page"],
			artist: ["Artists=true"],
			work: ["Gallery=page"],
			flash: ["Flash=page"],
			"flash-design": ["Flash=true"],
			request: [],
			about: [],
			services: [],
			faq: [],
			contact: [],
			policies: [],
			aftercare: [],
		};
		for (const [page, current] of Object.entries(expected)) {
			const items = navItems(all, page as ShellPage, true);
			assert.deepEqual(
				items.map((item) => item.href),
				["/", "/artists", "/gallery", "/flash"],
			);
			for (const item of items) assert.ok(isAllowedHref(item.href), item.href);
			assert.deepEqual(
				items
					.filter((item) => item.current !== undefined)
					.map((item) => `${item.label}=${item.current}`),
				current,
				page,
			);
		}
	});

	test("Artists and Flash only while the studio shows those sections", () => {
		assert.deepEqual(
			navItems(["work", "info", "inquiry"], "home", true).map(
				(item) => item.key,
			),
			["home", "gallery"],
		);
	});

	test("Artists only while an artist is visible: with none, /#artists lands nowhere", () => {
		assert.deepEqual(
			navItems(all, "home", false).map((item) => item.key),
			["home", "gallery", "flash"],
		);
	});
});
describe("the informational pages in the navigation (Prompt 7)", () => {
	const all = [...SECTION_KEYS];
	const pages = {
		about: true,
		takingWork: true,
		policies: true,
		aftercare: true,
		contact: true,
	};

	test("Services, About and Contact join the main links, each marking its own page", () => {
		const items = navItems(all, "services", true, pages);
		assert.deepEqual(
			items.map((item) => item.href),
			[
				"/",
				"/artists",
				"/gallery",
				"/flash",
				"/services",
				"/about",
				"/contact",
			],
		);
		assert.deepEqual(
			items.filter((item) => item.current).map((item) => item.key),
			["services"],
		);
		// No artist: no Services; nothing to reach the studio by: no Contact.
		assert.deepEqual(
			navItems(all, "home", false, { ...pages, contact: false }).map(
				(item) => item.href,
			),
			["/", "/gallery", "/flash", "/about"],
		);
	});

	test("no link leads to a not-found: About needs words or an artist, Services something to offer (review fix)", () => {
		const hrefs = (
			over: Partial<typeof pages>,
			artists = true,
			sections = all,
		) =>
			navItems(sections, "home", artists, { ...pages, ...over }).map(
				(item) => item.href,
			);
		assert.ok(!hrefs({ about: false }, false).includes("/about"));
		assert.ok(hrefs({ about: false }, true).includes("/about"));
		// Closed and no flash: nothing to offer.
		assert.ok(
			!hrefs(
				{ takingWork: false },
				true,
				all.filter((key) => key !== "flash"),
			).includes("/services"),
		);
		assert.ok(hrefs({ takingWork: false }, true).includes("/services"));
	});

	test("the footer lists the FAQ always, Policies and Aftercare only with content and Good to know shown", () => {
		assert.deepEqual(
			moreNavItems(all, "faq", pages).map((item) => [item.href, item.current]),
			[
				["/faq", "page"],
				["/policies", undefined],
				["/aftercare", undefined],
			],
		);
		assert.deepEqual(
			moreNavItems(
				all.filter((key) => key !== "info"),
				"home",
				pages,
			).map((item) => item.href),
			["/faq"],
		);
		assert.deepEqual(
			moreNavItems(all, "home", {
				...pages,
				policies: false,
				aftercare: false,
			}).map((item) => item.href),
			["/faq"],
		);
	});
});

describe("isRouterClick: which clicks the router takes over", () => {
	const click = {
		button: 0,
		metaKey: false,
		altKey: false,
		ctrlKey: false,
		shiftKey: false,
		defaultPrevented: false,
	};

	test("a plain click on one of the page's own paths", () => {
		assert.equal(isRouterClick(click, "/work"), true);
		assert.equal(isRouterClick(click, "/#artists"), true);
	});

	test("never a modified, other-button or handled click, or another origin", () => {
		for (const key of ["metaKey", "altKey", "ctrlKey", "shiftKey"]) {
			assert.equal(
				isRouterClick({ ...click, [key]: true }, "/work"),
				false,
				key,
			);
		}
		assert.equal(isRouterClick({ ...click, button: 1 }, "/work"), false);
		assert.equal(
			isRouterClick({ ...click, defaultPrevented: true }, "/work"),
			false,
		);
		for (const href of [
			"//evil.example/",
			"/\\evil.example",
			"https://instagram.com/x",
			"tel:+9779812345678",
			"#main",
		]) {
			assert.equal(isRouterClick(click, href), false, href);
		}
	});
});

describe("Ink Noir's pages", () => {
	test("is registered with its own shell, its own home, directory, artist, gallery and tattoo pages, and the shared pages", () => {
		assert.notEqual(THEMES["ink-noir"].Shell, THEMES["stencil-and-ink"].Shell);
		// Ink Noir's own pages (theme/ink-noir/home/, artists/, artist/, gallery/; their tests are ink-noir-*.test.ts).
		assert.equal(THEMES["ink-noir"].StudioPage, InkNoirStudioPage);
		assert.equal(THEMES["ink-noir"].ArtistPage, InkNoirArtistPage);
		assert.equal(THEMES["ink-noir"].WorkPage, InkNoirGalleryPage);
		assert.equal(THEMES["ink-noir"].ArtworkPage, InkNoirArtworkPage);
		assert.equal(THEMES["ink-noir"].RequestPage, InkNoirBookPage);
		for (const page of ["FlashPage", "FlashDesignPage"] as const) {
			assert.equal(
				THEMES["ink-noir"][page],
				THEMES["stencil-and-ink"][page],
				page,
			);
		}
	});

	test("hold to every rule of a studio page", () => {
		for (const html of [
			studioHtml(inkNoir()),
			studioHtml(
				inkNoir({ branding: { ...DEFAULT_STOREFRONT.branding, logo: LOGO } }),
			),
			studioHtml(inkNoir({}, GOOD_TO_KNOW_STUDIO)),
			studioHtml(inkNoir({}, EMPTY_STUDIO), []),
			studioHtml(inkNoir({}, CLOSED_STUDIO)),
			artistHtml(inkNoir()),
			requestHtml(inkNoir()),
			workHtml(inkNoir()),
			flashHtml(inkNoir()),
		]) {
			assertSafePage(html, { brandImages: true });
			const seen = ids(html);
			assert.deepEqual(seen, [...new Set(seen)], "every id once");
		}
	});

	test("frame the very content Stencil & Ink renders, except their own pages: only the shell differs", () => {
		assert.notEqual(
			mainOf(studioHtml(inkNoir())),
			mainOf(studioHtml(stencil())),
		);
		assert.notEqual(
			mainOf(artistHtml(inkNoir())),
			mainOf(artistHtml(stencil())),
		);
		assert.notEqual(
			mainOf(requestHtml(inkNoir())),
			mainOf(requestHtml(stencil())),
		);
		assert.notEqual(mainOf(workHtml(inkNoir())), mainOf(workHtml(stencil())));
		assert.equal(mainOf(flashHtml(inkNoir())), mainOf(flashHtml(stencil())));
	});

	test("open with a skip link to <main>, the header and its navigation", () => {
		const html = studioHtml(inkNoir());
		assert.match(
			html,
			/^<a class="ink-skip" href="#main">Skip to content<\/a><header class="ink-header">/,
		);
		// The home page lays out its own full-width sections (theme/ink-noir/home.css).
		assert.match(html, /<main id="main" tabindex="-1" class="ink-home">/);
		assert.match(html, /<nav class="ink-nav" aria-label="Main">/);
		const button =
			/<button [^>]*class="ink-menu-button"[^>]*>/.exec(html)?.[0] ?? "";
		for (const attribute of [
			'type="button"',
			'aria-haspopup="dialog"',
			'aria-expanded="false"',
		]) {
			assert.ok(button.includes(attribute), attribute);
		}
		// Radix's sheet is its own chunk, fetched on demand: none of it is in the server's page.
		assert.doesNotMatch(html, /data-slot="sheet/);
		assert.match(html, /<span class="sr-only">Menu<\/span>/);
		assert.doesNotMatch(html, /class="site-bar"/);
		assert.doesNotMatch(html, /class="site-footer"/);
	});

	test("mark the current page in the header and the footer", () => {
		assert.deepEqual(currentLinks(studioHtml(inkNoir())), [
			"Home=page",
			"Home=page",
		]);
		assert.deepEqual(currentLinks(artistHtml(inkNoir())), [
			"Artists=true",
			"Artists=true",
		]);
		assert.deepEqual(currentLinks(workHtml(inkNoir())), [
			"Gallery=page",
			"Gallery=page",
		]);
	});

	test("ask for a session in the header and the footer, by name on an open artist's page", () => {
		const home = studioHtml(inkNoir());
		assert.equal(
			home.match(
				/<a class="action action-primary ink-(header|footer)-cta" href="\/book">Request a session<\/a>/g,
			)?.length,
			2,
		);
		assert.match(
			artistHtml(inkNoir()),
			/class="action action-primary ink-header-cta" href="\/book\?artist=sita"><span>Request <bdi>Sita Rai<\/bdi><\/span>/,
		);
	});

	test("never offer a session nobody takes, nor on the request page itself", () => {
		for (const html of [
			studioHtml(inkNoir({}, CLOSED_STUDIO)),
			requestHtml(inkNoir()),
		]) {
			assert.doesNotMatch(html, /ink-(header|footer)-cta/);
		}
	});

	test("put the studio's own contacts, address, hours and links in the footer", () => {
		const html = studioHtml(inkNoir({}, GOOD_TO_KNOW_STUDIO));
		const footer = html.slice(html.indexOf('<footer class="ink-footer">'));
		assert.match(
			footer,
			/<p class="ink-footer-name" dir="auto">Black Needle<\/p>/,
		);
		for (const label of ["WhatsApp", "Viber", "Call", "Email"]) {
			assert.match(footer, new RegExp(`<span>${label}</span>`), label);
		}
		assert.match(footer, /Thamel Marg\nKathmandu/);
		assert.match(
			footer,
			/<dt>Hours<\/dt><dd><span>Sun – Fri<\/span><span>11 am – 8 pm<\/span><\/dd>/,
		);
		assert.match(
			footer,
			/<a href="https:\/\/instagram\.com\/blackneedle" rel="noopener noreferrer"><span>Instagram<\/span><\/a>/,
		);
		assert.match(
			footer,
			/<p dir="auto">© Black Needle<\/p><p>Studio page by Tattoo Drip<\/p>/,
		);
	});

	test("leave out a footer column the studio has nothing for", () => {
		const html = studioHtml(inkNoir({}, EMPTY_STUDIO), []);
		const footer = html.slice(html.indexOf('<footer class="ink-footer">'));
		assert.match(footer, /id="ink-footer-explore"/);
		for (const id of [
			"ink-footer-contact",
			"ink-footer-visit",
			"ink-footer-follow",
		]) {
			assert.doesNotMatch(footer, new RegExp(id), id);
		}
	});

	test("drop Artists from the header and footer of every page when no artist is visible", () => {
		const studio = inkNoir();
		const empty = (artists: Artist[]) =>
			renderToStaticMarkup(
				createElement(ThemedStudioPage, {
					data: studioPageData(studio, artists, ORIGIN, IMAGE_ORIGIN),
				}),
			);
		for (const html of [
			empty([]),
			renderToStaticMarkup(
				createElement(ThemedRequestPage, {
					data: requestPageData(studio, [], {}, ORIGIN, IMAGE_ORIGIN),
				}),
			),
			renderToStaticMarkup(
				createElement(ThemedWorkPage, {
					data: workPageData(studio, [], null, {}, ORIGIN, IMAGE_ORIGIN),
				}),
			),
			renderToStaticMarkup(
				createElement(ThemedFlashPage, {
					data: flashPageData(
						studio,
						[],
						EMPTY_FLASH_PAGE,
						{},
						ORIGIN,
						IMAGE_ORIGIN,
					),
				}),
			),
		]) {
			assert.doesNotMatch(html, /href="\/artists"/);
			assert.doesNotMatch(html, /id="artists"/);
		}
		// With an artist, the link is back and lands on the roster.
		const one = empty([SITA]);
		assert.match(one, /href="\/artists"/);
		assert.match(one, /id="artists"/);
	});

	test("drop Artists and Flash from the navigation when the studio hides them", () => {
		const html = studioHtml(
			inkNoir({ sections: [{ type: "work" }, { type: "inquiry" }] }),
		);
		assert.doesNotMatch(html, /href="\/artists"/);
		assert.doesNotMatch(html, /href="\/flash"/);
	});
});
