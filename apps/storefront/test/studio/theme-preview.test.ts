import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PreviewBanner } from "../../src/studio/components/preview-banner.tsx";
import { studioPageData } from "../../src/studio/loaders.ts";
import { THEME_KEYS } from "../../src/studio/theme/config.ts";
import {
	isUnthemedPage,
	matchedThemeKey,
} from "../../src/studio/theme/html.ts";
import {
	PREVIEW_HEADERS,
	previewHeaders,
	previewThemeOf,
	readPreviewTheme,
	THEME_NAMES,
	withPreviewTheme,
} from "../../src/studio/theme/preview.ts";
import { ThemedStudioPage } from "../../src/studio/theme/registry.tsx";
import { ARJUN, DEFAULT_STOREFRONT, ORIGIN, SITA, STUDIO } from "./fixtures.ts";
import { assertSafePage } from "./safety.ts";
import { IMAGE_ORIGIN, withStorefront } from "./theme-fixtures.ts";

/**
 * Page look's "Preview" links (theme/preview.ts): `?preview=<theme>` shows a
 * studio's page in that theme for one visit. These pin that only a theme key
 * is a preview, that it changes the theme alone (a copy: the cached studio is
 * untouched), that the answer is never cached or indexed, and that the
 * deposit page stays unthemed.
 */

const ink = (studio = STUDIO) =>
	withStorefront(
		{ ...DEFAULT_STOREFRONT, theme: "ink-noir", branding: { font: "serif" } },
		studio,
	);

describe("readPreviewTheme and previewThemeOf", () => {
	test("a theme this app has is a preview; every theme has a name to show", () => {
		for (const key of THEME_KEYS) {
			assert.equal(readPreviewTheme(key), key);
			assert.equal(
				previewThemeOf(
					`https://black-needle-48.tattoodrip.com/?preview=${key}`,
				),
				key,
			);
			assert.ok(THEME_NAMES[key]);
		}
	});

	test("anything else is none", () => {
		for (const value of [
			undefined,
			null,
			"",
			"classic",
			"Irezumi",
			" irezumi",
			"__proto__",
			"constructor",
			["irezumi"],
			7,
		]) {
			assert.equal(readPreviewTheme(value), null, JSON.stringify(value));
		}
		for (const url of [
			"https://black-needle-48.tattoodrip.com/",
			"https://black-needle-48.tattoodrip.com/?preview=",
			"https://black-needle-48.tattoodrip.com/?preview=classic",
			"https://black-needle-48.tattoodrip.com/?Preview=irezumi",
			"not a url",
		]) {
			assert.equal(previewThemeOf(url), null, url);
		}
		// The first value counts, as URLSearchParams reads it.
		assert.equal(
			previewThemeOf(
				"https://black-needle-48.tattoodrip.com/gallery?preview=irezumi&preview=ink-noir",
			),
			"irezumi",
		);
	});
});

describe("withPreviewTheme", () => {
	test("replaces the theme alone, on a copy", () => {
		const studio = ink();
		const before = JSON.stringify(studio);
		const previewed = withPreviewTheme(studio, "irezumi");
		assert.notEqual(previewed, studio);
		assert.equal(
			JSON.stringify(studio),
			before,
			"the cached studio is untouched",
		);
		assert.equal((previewed.storefront as { theme: string }).theme, "irezumi");
		assert.deepEqual(
			(previewed.storefront as { branding: unknown }).branding,
			{ font: "serif" },
			"the saved colours, font and sections stay",
		);
	});

	test("no preview is the very studio; a studio without a look still previews", () => {
		const studio = ink();
		assert.equal(withPreviewTheme(studio, null), studio);
		const bare = withStorefront(undefined);
		assert.equal(
			(withPreviewTheme(bare, "irezumi").storefront as { theme: string }).theme,
			"irezumi",
		);
	});

	test("every page and the <html> class draw the previewed theme", () => {
		const previewed = withPreviewTheme(ink(), "irezumi");
		const data = studioPageData(previewed, [SITA, ARJUN], ORIGIN, IMAGE_ORIGIN);
		assert.equal(data.theme.key, "irezumi");
		assert.equal(data.theme.font, "serif");
		const html = renderToStaticMarkup(
			createElement(ThemedStudioPage, { data }),
		);
		assert.match(html, /class="irz-header"/);
		const root = { routeId: "__root__", loaderData: previewed };
		assert.equal(matchedThemeKey([root, { routeId: "/" }]), "irezumi");
	});

	test("the deposit page stays unthemed, and shows no preview", () => {
		const root = {
			routeId: "__root__",
			loaderData: withPreviewTheme(ink(), "irezumi"),
		};
		const matches = [root, { routeId: "/deposit" }];
		assert.equal(matchedThemeKey(matches), "stencil-and-ink");
		assert.equal(isUnthemedPage(matches), true);
		assert.equal(isUnthemedPage([root, { routeId: "/" }]), false);
	});
});

describe("a preview's answer", () => {
	test("is never kept by a shared cache nor indexed; the rest of the answer is as it was", async () => {
		const page = new Response("<html></html>", {
			status: 200,
			headers: {
				"Cache-Control": "public, max-age=0, s-maxage=60",
				"Content-Type": "text/html",
			},
		});
		const answered = previewHeaders(page);
		assert.equal(answered.status, 200);
		assert.equal(answered.headers.get("Cache-Control"), "private, no-store");
		assert.equal(answered.headers.get("X-Robots-Tag"), "noindex, nofollow");
		assert.equal(answered.headers.get("Content-Type"), "text/html");
		assert.equal(await answered.text(), "<html></html>");
		assert.deepEqual(Object.keys(PREVIEW_HEADERS), [
			"Cache-Control",
			"X-Robots-Tag",
		]);
	});

	test("the middleware applies it to a preview request only", () => {
		const source = readFileSync(
			new URL("../../src/tenancy/middleware.ts", import.meta.url),
			"utf8",
		);
		assert.match(
			source,
			/const previewTheme = previewThemeOf\(request\.url\);/,
		);
		assert.match(
			source,
			/previewTheme === null\s*\? result\s*: \{ \.\.\.result, response: previewHeaders\(result\.response\) \}/,
		);
	});
});

describe("the preview banner", () => {
	test("names the theme, says nothing was saved, and leads out of the preview", () => {
		const html = renderToStaticMarkup(
			createElement(PreviewBanner, { theme: "irezumi", exitHref: "/gallery" }),
		);
		assert.match(
			html,
			/<aside class="preview-banner" aria-label="Theme preview">/,
		);
		assert.match(html, /Previewing Irezumi/);
		assert.match(html, /Not saved: visitors still see your saved theme\./);
		assert.match(
			html,
			/<a class="preview-banner-exit" href="\/gallery">Exit preview<\/a>/,
		);
	});

	test("the root writes it after the page and a noindex meta, never on an unthemed page", () => {
		const source = readFileSync(
			new URL("../../src/routes/__root.tsx", import.meta.url),
			"utf8",
		);
		assert.match(
			source,
			/const preview = unthemed \? null : site\.previewTheme;/,
		);
		assert.ok(
			source.indexOf("{children}") < source.indexOf("<PreviewBanner"),
			"after the page in reading order: the skip link stays first",
		);
		assert.match(source, /<meta name="robots" content="noindex, nofollow" \/>/);
	});

	test("a previewed page still holds to every page rule", () => {
		const data = studioPageData(
			withPreviewTheme(ink(), "irezumi"),
			[SITA, ARJUN],
			ORIGIN,
			IMAGE_ORIGIN,
		);
		assertSafePage(
			renderToStaticMarkup(createElement(ThemedStudioPage, { data })),
		);
	});
});
