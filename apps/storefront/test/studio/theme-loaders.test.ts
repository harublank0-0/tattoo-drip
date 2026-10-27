import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Studio } from "@tattoo-drip/sdk";
import {
	connectServer,
	createApiContext,
	seedStudio,
} from "../../src/api/context.ts";
import { SiteRef } from "../../src/site/context.ts";
import {
	artistPageData,
	loadArtistPage,
	loadStudioPage,
	studioPageData,
} from "../../src/studio/loaders.ts";
import { brandingCss } from "../../src/studio/theme/branding.ts";
import { DEFAULT_THEME_CONFIG } from "../../src/studio/theme/config.ts";
import { storefrontInput } from "../../src/studio/theme/source.ts";
import { fakeFetch, json } from "../tenancy/helpers.ts";
import { ARJUN, ORIGIN, SITA, STUDIO } from "./fixtures.ts";
import {
	API_COVER,
	API_COVER_SRCSET,
	BRANDED,
	COVER,
	IMAGE_ORIGIN,
	LOGO,
	withCover,
	withStorefront,
} from "./theme-fixtures.ts";

/** A server render's context against an API at `apiUrl`, the studio seeded. */
function pageContext(studio: Studio, apiUrl: string) {
	const { fetch } = fakeFetch(({ url }) =>
		url.endsWith("/artists")
			? json(200, { data: [SITA, ARJUN] })
			: json(404, { error: { code: "not_found", message: "Not found." } }),
	);
	const api = createApiContext("server");
	connectServer(api, { config: { apiUrl }, studio, fetch });
	seedStudio(api, studio);
	const site = new SiteRef();
	site.connect(ORIGIN);
	return { ...api, site };
}

const BRANDED_THEME = {
	key: "stencil-and-ink",
	sections: ["inquiry", "artists"],
	accent: "#b91c1c",
	accentDark: null,
	font: "serif",
	logo: { src: LOGO.url, width: 600, height: 200 },
	heroImage: { src: COVER.url, width: 2048, height: 1024, alt: "" },
};

describe("the seam: storefrontInput (TAT-54)", () => {
	test("today's studio has no storefront: nothing", () => {
		assert.equal(storefrontInput(STUDIO), undefined);
		assert.equal(Object.hasOwn(STUDIO, "storefront"), false);
	});

	test("hands on whatever the API sent, unchecked", () => {
		assert.equal(storefrontInput(withStorefront(BRANDED)), BRANDED);
		assert.equal(storefrontInput(withStorefront("nonsense")), "nonsense");
	});
});

describe("the seam brings the studio's cover in as the hero image (TAT-116)", () => {
	test("a studio without a cover gives exactly the input it gave before", () => {
		assert.equal(storefrontInput(STUDIO), undefined);
		assert.equal(storefrontInput(withCover(STUDIO, null)), undefined);
		assert.equal(storefrontInput(withStorefront(BRANDED)), BRANDED);
		assert.equal(
			storefrontInput({ ...withStorefront(BRANDED), cover: null } as Studio),
			BRANDED,
		);
		// An older API that doesn't send the property at all.
		assert.equal(Object.hasOwn(STUDIO, "cover"), true);
		const { cover: _cover, ...older } = STUDIO;
		assert.equal(storefrontInput(older as Studio), undefined);
	});

	test("a cover becomes branding.heroImage; the rest of a branded input is kept", () => {
		assert.deepEqual(storefrontInput(withCover()), {
			branding: { heroImage: API_COVER },
		});
		const input = storefrontInput(withCover(withStorefront(BRANDED)));
		assert.deepEqual(input, {
			...BRANDED,
			branding: { ...BRANDED.branding, heroImage: API_COVER },
		});
		// The cover wins over a hero image a configuration might carry.
		assert.notEqual(
			(input as { branding: { heroImage: unknown } }).branding.heroImage,
			COVER,
		);
	});

	test("a configuration that is not an object is replaced, not merged into", () => {
		for (const storefront of ["nonsense", 7, [1, 2], null, true]) {
			assert.deepEqual(storefrontInput(withCover(withStorefront(storefront))), {
				branding: { heroImage: API_COVER },
			});
		}
		// A branding that is not an object too.
		assert.deepEqual(
			storefrontInput(
				withCover(withStorefront({ branding: "x", theme: "stencil-and-ink" })),
			),
			{ theme: "stencil-and-ink", branding: { heroImage: API_COVER } },
		);
	});

	test("the page data's hero image is the cover, checked like any brand image", () => {
		const studio = withCover();
		const theme = studioPageData(studio, [SITA], ORIGIN, IMAGE_ORIGIN).theme;
		assert.deepEqual(theme.heroImage, {
			src: API_COVER.url,
			width: 2048,
			height: 1536,
			alt: "",
			srcSet: API_COVER_SRCSET,
		});
		assert.deepEqual(
			artistPageData(studio, [SITA], "sita", ORIGIN, IMAGE_ORIGIN)?.theme
				.heroImage,
			theme.heroImage,
		);
		// Everything else in the theme stays the default's.
		assert.deepEqual({ ...theme, heroImage: null }, DEFAULT_THEME_CONFIG);
	});

	test("a cover off the API's origin, or with no origin to check against, is no cover", () => {
		const elsewhere = withCover(STUDIO, {
			...API_COVER,
			url: "https://evil.example/cover.jpg",
		});
		assert.equal(
			studioPageData(elsewhere, [SITA], ORIGIN, IMAGE_ORIGIN).theme.heroImage,
			null,
		);
		assert.equal(
			studioPageData(withCover(), [SITA], ORIGIN).theme.heroImage,
			null,
		);
		// With no cover accepted the theme is the default object itself.
		assert.equal(
			studioPageData(elsewhere, [SITA], ORIGIN, IMAGE_ORIGIN).theme.logo,
			null,
		);
	});

	test("hostile cover values are dropped and never break the page", () => {
		for (const cover of [
			"nonsense",
			7,
			[],
			{ url: "javascript:alert(1)", width: 2048, height: 1536 },
			{ url: API_COVER.url, width: 0, height: 1536 },
			{ url: API_COVER.url, width: 2048, height: 99999 },
			{ url: `${API_COVER.url} x`, width: 2048, height: 1536 },
			{ ...API_COVER, alt: '"><script>alert(1)</script>', variants: "x" },
		]) {
			const theme = studioPageData(
				withCover(STUDIO, cover),
				[SITA],
				ORIGIN,
				IMAGE_ORIGIN,
			).theme;
			if (theme.heroImage) {
				// The only survivor is the one with a hostile description: its
				// text is plain, and its copies are gone.
				assert.equal(theme.heroImage.src, API_COVER.url);
				assert.equal("srcSet" in theme.heroImage, false);
			}
		}
	});

	test("a cover alone writes no brand <style>", () => {
		const theme = studioPageData(
			withCover(),
			[SITA],
			ORIGIN,
			IMAGE_ORIGIN,
		).theme;
		assert.ok(theme.heroImage);
		assert.equal(brandingCss(theme), null);
	});
});

describe("the page data's theme (TAT-54)", () => {
	test("a studio without a storefront gets the default theme, on both pages", () => {
		assert.deepEqual(
			studioPageData(STUDIO, [SITA, ARJUN], ORIGIN).theme,
			DEFAULT_THEME_CONFIG,
		);
		assert.deepEqual(
			artistPageData(STUDIO, [SITA, ARJUN], "sita", ORIGIN)?.theme,
			DEFAULT_THEME_CONFIG,
		);
	});

	test("a studio's config is checked into its theme; images only with the API's origin", () => {
		const studio = withStorefront(BRANDED);
		assert.deepEqual(
			studioPageData(studio, [SITA], ORIGIN, IMAGE_ORIGIN).theme,
			BRANDED_THEME,
		);
		assert.deepEqual(
			artistPageData(studio, [SITA], "sita", ORIGIN, IMAGE_ORIGIN)?.theme,
			BRANDED_THEME,
		);
		const noOrigin = studioPageData(studio, [SITA], ORIGIN).theme;
		assert.equal(noOrigin.logo, null);
		assert.equal(noOrigin.heroImage, null);
	});

	test("the theme changes nothing else in the data", () => {
		const plain = studioPageData(STUDIO, [SITA, ARJUN], ORIGIN);
		const branded = studioPageData(
			withStorefront({ sections: [{ type: "inquiry", props: {} }] }),
			[SITA, ARJUN],
			ORIGIN,
			IMAGE_ORIGIN,
		);
		assert.deepEqual(branded.theme.sections, ["inquiry"]);
		// Hiding the roster leaves the form's choice of artists as it was.
		assert.deepEqual({ ...branded, theme: null }, { ...plain, theme: null });
	});

	test("the loaders check images against the API's own origin", async () => {
		const studio = withStorefront(BRANDED);
		const onApi = await loadStudioPage(pageContext(studio, IMAGE_ORIGIN));
		assert.deepEqual(onApi.theme.logo, BRANDED_THEME.logo);
		const artist = await loadArtistPage(
			pageContext(studio, IMAGE_ORIGIN),
			"sita",
		);
		assert.deepEqual(artist.theme.heroImage, BRANDED_THEME.heroImage);
		// The same images, served from an API somewhere else: refused.
		const elsewhere = await loadStudioPage(
			pageContext(studio, "https://other-api.example.com"),
		);
		assert.equal(elsewhere.theme.logo, null);
		assert.equal(elsewhere.theme.heroImage, null);
		assert.equal(elsewhere.theme.accent, "#b91c1c");
	});
});
