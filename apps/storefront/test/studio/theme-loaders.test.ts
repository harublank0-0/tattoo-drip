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
import { DEFAULT_THEME_CONFIG } from "../../src/studio/theme/config.ts";
import { storefrontInput } from "../../src/studio/theme/source.ts";
import { fakeFetch, json } from "../tenancy/helpers.ts";
import { ARJUN, ORIGIN, SITA, STUDIO } from "./fixtures.ts";
import {
	BRANDED,
	COVER,
	IMAGE_ORIGIN,
	LOGO,
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
