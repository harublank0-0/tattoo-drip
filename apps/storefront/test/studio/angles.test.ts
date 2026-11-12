import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isRedirect } from "@tanstack/react-router";
import type { GalleryPhoto, Studio, WorkPage } from "@tattoo-drip/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	connectServer,
	createApiContext,
	seedStudio,
} from "../../src/api/context.ts";
import { SiteRef } from "../../src/site/context.ts";
import {
	artworkShapeClass,
	galleryPhotoView,
	galleryView,
	MAX_ANGLES,
} from "../../src/studio/gallery.ts";
import {
	type ArtworkPageData,
	artworkPageData,
	loadArtworkPage,
	type WorkPageData,
	workPageData,
} from "../../src/studio/loaders.ts";
import {
	ThemedArtworkPage,
	ThemedWorkPage,
} from "../../src/studio/theme/registry.tsx";
import { fakeFetch, json } from "../tenancy/helpers.ts";
import {
	ARJUN,
	DEFAULT_STOREFRONT,
	galleryPage,
	ORIGIN,
	photoId,
	SITA,
	STUDIO,
} from "./fixtures.ts";
import { assertSafePage } from "./safety.ts";
import { IMAGE_ORIGIN, withStorefront } from "./theme-fixtures.ts";

/**
 * Angles: one tattoo shown with several photos (the contract's
 * GalleryPhoto.angles). These pin the view's reading of them (at most seven,
 * the brand images' rule, the alt fallback "Tattoo by {name}, photo {n} of
 * {count}"), the "n photos" mark on every theme's tiles, the row of photos
 * and the stepping viewer on the tattoo's page, and the permanent redirect
 * from one of a tattoo's other photos to the tattoo's own page. A tattoo of
 * one photo is pinned unchanged by the existing render tests.
 */

const THEMES = ["stencil-and-ink", "ink-noir", "irezumi", "atelier"] as const;
type ThemeName = (typeof THEMES)[number];

const themed = (theme: ThemeName, studio: Studio = STUDIO): Studio =>
	withStorefront({ ...DEFAULT_STOREFRONT, theme }, studio);

/** An angle as the API sends it: on the API's origin, with its copies. */
const angle = (n: number, alt: string | null = null, width = 1200) => ({
	url: `https://api.example.com/uploads/tenants/t/artist_work_photo/a${n}.320-640.jpg`,
	width,
	height: 1600,
	alt,
	variants: [320, 640].map((copy) => ({
		url: `https://api.example.com/uploads/tenants/t/artist_work_photo/a${n}.${copy}w.jpg`,
		width: copy,
	})),
});

/** A gallery page whose first entry is a tattoo of three photos: its main photo and two angles. */
function pageWithTattoo(count = 2): WorkPage {
	const base = galleryPage(count);
	return {
		...base,
		data: base.data.map((photo, index) =>
			index === 0
				? { ...photo, angles: [angle(2, "From the side"), angle(3)] }
				: photo,
		),
	};
}

const tattoo = (): GalleryPhoto => pageWithTattoo(1).data[0];

function workHtml(theme: ThemeName, page = pageWithTattoo()): string {
	const data: WorkPageData = workPageData(
		themed(theme),
		[SITA, ARJUN],
		page,
		{},
		ORIGIN,
		IMAGE_ORIGIN,
	);
	return renderToStaticMarkup(createElement(ThemedWorkPage, { data }));
}

function artworkHtml(theme: ThemeName, photo: unknown = tattoo()): string {
	const data: ArtworkPageData | null = artworkPageData(
		themed(theme),
		[SITA, ARJUN],
		photo,
		[null, null, null],
		ORIGIN,
		IMAGE_ORIGIN,
	);
	assert.ok(data, "the tattoo can be shown");
	return renderToStaticMarkup(createElement(ThemedArtworkPage, { data }));
}

describe("reading a tattoo's angles", () => {
	test("keeps them in order, each by the brand images' rule, with its own description or its place in the whole tattoo", () => {
		const [photo, single] = galleryView(pageWithTattoo(), IMAGE_ORIGIN).photos;
		assert.equal(photo.photosLabel, "3 photos");
		assert.deepEqual(
			photo.angles.map((shot) => [shot.alt, shot.caption]),
			[
				["From the side", "From the side"],
				["Tattoo by Sita Rai, photo 3 of 3", null],
			],
		);
		assert.match(photo.angles[0].srcSet ?? "", /a2\.320w\.jpg 320w/);
		assert.match(photo.angles[1].largeSrc, /a3\.320-640\.jpg$/);
		assert.deepEqual(single.angles, []);
		assert.equal(single.photosLabel, null);
	});

	test("drops an angle off the image origin or without a size, and reads seven at most", () => {
		const hostile = {
			...tattoo(),
			angles: [
				{ ...angle(2), url: "https://evil.example.com/x.jpg" },
				{ ...angle(3), width: 0 },
				"not an angle",
				...Array.from({ length: 9 }, (_, index) => angle(index + 4)),
			],
		};
		const [photo] = galleryView(
			{ ...pageWithTattoo(1), data: [hostile] },
			IMAGE_ORIGIN,
		).photos;
		// The first seven sent: three refused, four kept.
		assert.equal(MAX_ANGLES, 7);
		assert.equal(photo.angles.length, 4);
		assert.equal(photo.photosLabel, "5 photos");
		assert.equal(photo.angles[3].alt, "Tattoo by Sita Rai, photo 5 of 5");
		const older = galleryView(
			{ ...pageWithTattoo(1), data: [{ ...tattoo(), angles: undefined }] },
			IMAGE_ORIGIN,
		).photos[0];
		assert.deepEqual(older.angles, []);
	});

	test("the tattoo's page numbers its main photo too, when it has no description", () => {
		const view = galleryPhotoView(tattoo(), IMAGE_ORIGIN);
		assert.ok(view);
		assert.equal(view.alt, "Tattoo by Sita Rai, photo 1 of 3");
		const one = galleryPhotoView(galleryPage(1).data[0], IMAGE_ORIGIN);
		assert.equal(one?.alt, "Tattoo by Sita Rai");
	});

	test("the page's main photo keeps its own shape, in 0.05 steps from 1:2 to 2:1", () => {
		assert.equal(
			artworkShapeClass({ width: 2048, height: 1536 }),
			"artwork-ar-135",
		);
		assert.equal(
			artworkShapeClass({ width: 1200, height: 1600 }),
			"artwork-ar-75",
		);
		assert.equal(
			artworkShapeClass({ width: 100, height: 1000 }),
			"artwork-ar-50",
		);
		assert.equal(
			artworkShapeClass({ width: 5000, height: 1000 }),
			"artwork-ar-200",
		);
	});
});

describe("every theme's gallery marks a tattoo of several photos", () => {
	for (const theme of THEMES) {
		test(`${theme}: "3 photos" on the tattoo's tile, as part of its name, and nothing on a single photo's`, () => {
			const html = workHtml(theme);
			assertSafePage(html);
			assert.equal(html.match(/>3 photos</g)?.length, 1, "one mark");
			// The mark sits inside the tile's link or button, so it is part of its name.
			const tile =
				/<(a|button) [^>]*>(?:(?!<\/\1>)[\s\S])*?>3 photos<\/span>/.exec(html);
			assert.ok(tile, "the mark is inside the tile's link or button");
			assert.doesNotMatch(html, />1 photos?</);
		});
	}
});

describe("the tattoo's page shows every photo of it", () => {
	for (const theme of THEMES) {
		test(`${theme}: the main photo in its own box, a row of buttons for the three photos, the first pressed, and a viewer that steps`, () => {
			const html = artworkHtml(theme);
			assertSafePage(html);
			const main =
				/<img class="artwork-photo artwork-photo-steady artwork-ar-135"[^>]*>/.exec(
					html,
				)?.[0];
			assert.ok(main, "the main photo keeps the main photo's shape class");
			assert.match(main, / width="2048" height="1536"/);
			assert.match(main, / alt="Tattoo by Sita Rai, photo 1 of 3"/);
			const row =
				/<div class="artwork-angles" role="group" aria-label="Photos of this tattoo">([\s\S]*?)<\/div>/.exec(
					html,
				)?.[1];
			assert.ok(row, "the row of photos");
			const buttons = row.match(/<button [^>]*>/g) ?? [];
			assert.equal(buttons.length, 3);
			assert.deepEqual(
				buttons.map((button) => /aria-pressed="(\w+)"/.exec(button)?.[1]),
				["true", "false", "false"],
			);
			assert.deepEqual(
				Array.from(row.matchAll(/ alt="([^"]*)"/g), (match) => match[1]),
				[
					"Tattoo by Sita Rai, photo 1 of 3",
					"From the side",
					"Tattoo by Sita Rai, photo 3 of 3",
				],
			);
			// The viewer: the same dialog, its place announced, and its two steps.
			const dialog =
				/<dialog [^>]*class="work-dialog work-dialog-tattoo"[\s\S]*?<\/dialog>/.exec(
					html,
				)?.[0];
			assert.ok(dialog, "the tattoo's viewer");
			assert.match(dialog, /<p aria-live="polite">Photo 1 of 3<\/p>/);
			assert.match(
				dialog,
				/<button type="button" class="action action-secondary" aria-disabled="true">Previous photo<\/button>/,
			);
			assert.match(
				dialog,
				/<button type="button" class="action action-secondary">Next photo<\/button>/,
			);
			// Nothing moves: no animation or transition is set inline (none can be).
			assert.doesNotMatch(dialog, / style=/);
		});
	}

	test("a tattoo of one photo has no row and no steps, as before", () => {
		for (const theme of THEMES) {
			const html = artworkHtml(theme, galleryPage(1).data[0]);
			assert.doesNotMatch(
				html,
				/artwork-angles|work-steps|artwork-photo-steady/,
				theme,
			);
		}
	});
});

describe("an angle's old address", () => {
	const API = "http://api.test";
	function context(fetch: typeof globalThis.fetch) {
		const api = createApiContext("server");
		connectServer(api, {
			config: { apiUrl: API, mediaUrl: IMAGE_ORIGIN },
			studio: STUDIO,
			fetch,
		});
		seedStudio(api, STUDIO);
		const site = new SiteRef();
		site.connect(ORIGIN);
		return { ...api, site };
	}

	test("is a permanent redirect to the tattoo's own page, with the query as it was; the tattoo's own id is the page", async () => {
		const angleId = photoId(42);
		const { calls, fetch } = fakeFetch(({ url }) => {
			if (url.endsWith("/artists")) return json(200, { data: [SITA] });
			// Asked by the angle's id, the API answers with the tattoo itself.
			if (url.includes("/work/")) return json(200, { data: tattoo() });
			if (url.includes("/work?")) return json(200, galleryPage(0));
			return json(404, { error: { code: "not_found", message: "Not found." } });
		});

		const thrown = await loadArtworkPage(
			context(fetch),
			angleId,
			"?preview=atelier",
		).then(
			() => null,
			(error: unknown) => error,
		);
		assert.ok(isRedirect(thrown), "a redirect");
		const { options } = thrown as unknown as {
			options: { href: string; statusCode: number };
		};
		assert.equal(options.statusCode, 301);
		assert.equal(options.href, `/gallery/${photoId(1)}?preview=atelier`);
		// No related reads for a page that is not shown.
		assert.equal(calls.filter(({ url }) => url.includes("/work?")).length, 0);

		const data = await loadArtworkPage(context(fetch), photoId(1));
		assert.equal(data.artwork.id, photoId(1));
		assert.equal(data.artwork.photo.angles.length, 2);
	});
});
