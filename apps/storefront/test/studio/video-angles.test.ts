import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { GalleryPhoto, Studio, WorkPage } from "@tattoo-drip/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TattooDialog, TattooFigureVideo } from "../../src/studio/angles.tsx";
import {
	focusAfterViewerClose,
	placeWords,
	stepWords,
	videoAttributes,
} from "../../src/studio/angles-model.ts";
import {
	durationText,
	galleryPhotoView,
	galleryView,
	SMALL_VIDEO_MEDIA,
	type VideoAngleView,
} from "../../src/studio/gallery.ts";
import {
	type ArtworkPageData,
	artworkPageData,
	type WorkPageData,
	workPageData,
} from "../../src/studio/loaders.ts";
import {
	ThemedArtworkPage,
	ThemedWorkPage,
} from "../../src/studio/theme/registry.tsx";
import {
	ARJUN,
	DEFAULT_STOREFRONT,
	galleryPage,
	ORIGIN,
	SITA,
	STUDIO,
} from "./fixtures.ts";
import { assertSafePage } from "./safety.ts";
import { IMAGE_ORIGIN, withStorefront } from "./theme-fixtures.ts";

/**
 * Video angles: a tattoo's short videos among its angles (the contract's
 * VideoAngle). These pin the reading (a video's poster by the brand images'
 * rule, its sources MP4s on that origin, smallest first with `media` on the
 * smaller, a kind this page doesn't know skipped), the tile's honest mark in
 * every theme, the thumbnail (poster, play mark, the length as text, named
 * "Video, 0:42") and the video in the viewer (muted, inline, controls,
 * nothing loaded before play, never autoplayed, the poster, contained).
 */

const THEMES = [
	"stencil-and-ink",
	"ink-noir",
	"irezumi",
	"atelier",
	"flash-parlour",
] as const;
type ThemeName = (typeof THEMES)[number];
const SHARED_CSS = readFileSync(
	new URL("../../src/styles.css", import.meta.url),
	"utf8",
);

const themed = (theme: ThemeName, studio: Studio = STUDIO): Studio =>
	withStorefront({ ...DEFAULT_STOREFRONT, theme }, studio);

const UPLOADS = "https://api.example.com/uploads/tenants/t/work_video";

const photoAngle = {
	kind: "photo" as const,
	url: "https://api.example.com/uploads/tenants/t/artist_work_photo/a2.jpg",
	width: 1200,
	height: 1600,
	alt: "From the side",
	variants: [],
};

/** A video angle as the API sends it: 42 s, 720p and 1080p, largest first to prove the order is the page's. */
const videoAngle = (alt: string | null = null) => ({
	kind: "video" as const,
	poster: {
		url: `${UPLOADS}/v.320-640.jpg`,
		width: 1080,
		height: 1920,
		alt,
		variants: [320, 640].map((width) => ({
			url: `${UPLOADS}/v.${width}w.jpg`,
			width,
		})),
	},
	sources: [
		{
			url: `${UPLOADS}/v.1080x1920.mp4`,
			type: "video/mp4" as const,
			width: 1080,
			height: 1920,
		},
		{
			url: `${UPLOADS}/v.720x1280.mp4`,
			type: "video/mp4" as const,
			width: 720,
			height: 1280,
		},
	],
	durationMs: 42_000,
	alt,
});

/** A tattoo of three: its main photo, a photo and a video. */
function tattoo(angles: unknown[] = [photoAngle, videoAngle()]): GalleryPhoto {
	return { ...galleryPage(1).data[0], angles } as GalleryPhoto;
}

function pageOf(photo: GalleryPhoto): WorkPage {
	const base = galleryPage(2);
	return { ...base, data: [photo, base.data[1]] };
}

describe("reading a tattoo's videos", () => {
	test("a video keeps its place, its poster and copies, its sources smallest first with media on the smaller, and its length", () => {
		const view = galleryPhotoView(tattoo(), IMAGE_ORIGIN);
		assert.ok(view);
		assert.equal(view.photosLabel, "3 photos and videos");
		assert.deepEqual(
			view.angles.map((angle) => angle.kind),
			["photo", "video"],
		);
		const video = view.angles[1] as VideoAngleView;
		assert.equal(video.poster.src, `${UPLOADS}/v.320-640.jpg`);
		assert.match(video.poster.srcSet ?? "", /v\.320w\.jpg 320w/);
		assert.deepEqual(video.sources, [
			{
				src: `${UPLOADS}/v.720x1280.mp4`,
				type: "video/mp4",
				width: 720,
				height: 1280,
				media: SMALL_VIDEO_MEDIA,
			},
			{
				src: `${UPLOADS}/v.1080x1920.mp4`,
				type: "video/mp4",
				width: 1080,
				height: 1920,
			},
		]);
		assert.deepEqual([video.width, video.height], [1080, 1920]);
		assert.equal(video.durationText, "0:42");
		assert.equal(video.alt, "Video, 0:42");
		assert.equal(video.label, "Video, 0:42");
		assert.equal(video.caption, null);
		// The photo after the main one is still numbered in the whole tattoo.
		assert.equal(view.alt, "Tattoo by Sita Rai, photo 1 of 3");
	});

	test("a described video is named by its description, its button says it is a video too", () => {
		const view = galleryPhotoView(
			tattoo([videoAngle("Healed, in the sun")]),
			IMAGE_ORIGIN,
		);
		const video = view?.angles[0] as VideoAngleView;
		assert.equal(video.alt, "Healed, in the sun");
		assert.equal(video.label, "Video, 0:42: Healed, in the sun");
		assert.equal(video.caption, "Healed, in the sun");
	});

	test("ignores an unknown kind, a video off the image origin or without a usable source or length, safely; an angle with no kind is a photo (an older API)", () => {
		const { kind: _, ...kindless } = photoAngle;
		const angles = [
			kindless,
			{ ...photoAngle, kind: "hologram" },
			{
				...videoAngle(),
				poster: {
					...videoAngle().poster,
					url: "https://evil.example.com/p.jpg",
				},
			},
			{
				...videoAngle(),
				sources: [
					{ ...videoAngle().sources[0], url: "https://evil.example.com/v.mp4" },
					{ ...videoAngle().sources[1], type: "video/webm" },
				],
			},
			{ ...videoAngle(), durationMs: 61_000 },
			{ ...videoAngle(), durationMs: "42" },
			{
				...videoAngle(),
				sources: [{ ...videoAngle().sources[1], url: "javascript:alert(1)" }],
			},
			"not an angle",
		];
		const view = galleryPhotoView(tattoo(angles), IMAGE_ORIGIN);
		assert.ok(view);
		assert.deepEqual(
			view.angles.map((angle) => angle.kind),
			["photo"],
		);
		assert.equal(view.photosLabel, "2 photos");
		const page = galleryView(pageOf(tattoo(angles)), IMAGE_ORIGIN);
		assert.equal(page.photos[0].angles.length, 1);
	});

	test("a length reads as minutes and seconds", () => {
		assert.equal(durationText(42_000), "0:42");
		assert.equal(durationText(60_000), "1:00");
		assert.equal(durationText(400), "0:01");
	});
});

function workHtml(theme: ThemeName): string {
	const data: WorkPageData = workPageData(
		themed(theme),
		[SITA, ARJUN],
		pageOf(tattoo()),
		{},
		ORIGIN,
		IMAGE_ORIGIN,
	);
	return renderToStaticMarkup(createElement(ThemedWorkPage, { data }));
}

function artworkHtml(theme: ThemeName): string {
	const data: ArtworkPageData | null = artworkPageData(
		themed(theme),
		[SITA, ARJUN],
		tattoo(),
		[null, null, null],
		ORIGIN,
		IMAGE_ORIGIN,
	);
	assert.ok(data);
	return renderToStaticMarkup(createElement(ThemedArtworkPage, { data }));
}

describe("every theme says a tattoo has videos, and shows them", () => {
	for (const theme of THEMES) {
		test(`${theme}: "3 photos and videos" on the tile, inside its link or button; the page's row has a video thumbnail named "Video, 0:42" with a play mark and its length`, () => {
			const work = workHtml(theme);
			assertSafePage(work);
			assert.equal(
				work.match(/> ?3 photos and videos</g)?.length,
				1,
				"one honest mark",
			);
			assert.ok(
				/<(a|button) [^>]*>(?:(?!<\/\1>)[\s\S])*?> ?3 photos and videos<\/span>/.exec(
					work,
				),
				"the mark is part of the tile's name",
			);

			const page = artworkHtml(theme);
			assertSafePage(page);
			const row =
				/<div class="artwork-angles" role="group" aria-label="Photos of this tattoo">([\s\S]*?)<\/div>/.exec(
					page,
				)?.[1];
			assert.ok(row, "the row");
			const thumb =
				/<button type="button" class="artwork-angle artwork-angle-video"[^>]*>([\s\S]*?)<\/button>/.exec(
					row,
				);
			assert.ok(thumb, "the video's thumbnail");
			// Named by its poster's alt: the button reads "Video, 0:42".
			assert.match(
				thumb[1],
				/<img src="[^"]*v\.320-640\.jpg"[^>]* alt="Video, 0:42"/,
			);
			assert.match(
				thumb[1],
				/<svg class="artwork-angle-play" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle [^>]*><\/circle><path [^>]*><\/path><\/svg>/,
			);
			assert.match(
				thumb[1],
				/<span class="artwork-angle-time" aria-hidden="true">0:42<\/span>/,
			);
			// The page opens on the main photo: no video is on it, so none can play.
			assert.doesNotMatch(page.split("<dialog")[0], /<video/);
		});
	}
});

describe("a video shown", () => {
	const video = () =>
		galleryPhotoView(tattoo(), IMAGE_ORIGIN)?.angles[1] as VideoAngleView;

	test("its element: muted, inline, controls, nothing loaded before play, the poster, its own size, never autoplayed; it loops only without reduced motion", () => {
		const one = video();
		const moving = videoAttributes(one, false);
		assert.deepEqual(moving, {
			width: 1080,
			height: 1920,
			poster: `${UPLOADS}/v.320-640.jpg`,
			"aria-label": "Video, 0:42",
			muted: true,
			playsInline: true,
			loop: true,
			controls: true,
			preload: "none",
			autoPlay: false,
		});
		assert.deepEqual(videoAttributes(one, true), { ...moving, loop: false });
	});

	test("in the viewer: its sources smallest first, the smaller for small screens, in the stage; the place says video and the steps name what comes next", () => {
		const view = galleryPhotoView(tattoo(), IMAGE_ORIGIN);
		assert.ok(view);
		const html = renderToStaticMarkup(
			createElement(TattooDialog, { photo: view, facts: null, index: 2 }),
		);
		assertSafePage(`<h1>x</h1>${html}`);
		assert.match(html, /<p aria-live="polite">Video 3 of 3<\/p>/);
		assert.match(html, /^<dialog [^>]*aria-label="Video, 0:42"/);
		const element = /<video [^>]*>([\s\S]*?)<\/video>/.exec(html);
		assert.ok(element, "the video in the stage");
		assert.match(element[0], /^<video class="work-large work-video"/);
		assert.deepEqual(
			Array.from(
				element[1].matchAll(/<source ([^>]*?)\/?>/g),
				(match) => match[1],
			),
			[
				`src="${UPLOADS}/v.720x1280.mp4" type="video/mp4" media="${SMALL_VIDEO_MEDIA}"`,
				`src="${UPLOADS}/v.1080x1920.mp4" type="video/mp4"`,
			],
		);
		// At the end: the step back names a photo, the step on is plain (it goes nowhere).
		assert.match(
			html,
			/<button type="button" class="action action-secondary">Previous: photo<\/button>/,
		);
		assert.match(
			html,
			/<button type="button" class="action action-secondary" aria-disabled="true">Next<\/button>/,
		);
		assert.doesNotMatch(element[0], /draggable/);
		// On the photo before it, the step on names the video.
		const before = renderToStaticMarkup(
			createElement(TattooDialog, { photo: view, facts: null, index: 1 }),
		);
		assert.match(before, /<p aria-live="polite">Photo 2 of 3<\/p>/);
		assert.match(before, />Next: video<\/button>/);
	});

	test("a tattoo of photos only keeps its words", () => {
		assert.deepEqual(stepWords(["photo", "photo", "photo"], 1), {
			previous: "Previous photo",
			next: "Next photo",
		});
		assert.equal(placeWords("photo", 2, 3), "Photo 2 of 3");
		assert.deepEqual(stepWords(["photo", "video", "photo"], 0), {
			previous: "Previous",
			next: "Next: video",
		});
	});

	test('on the page: in the main photo\'s box, with the line "Video, no sound" where "View full screen" stands, so nothing moves', () => {
		const html = renderToStaticMarkup(
			createElement(TattooFigureVideo, {
				video: video(),
				shapeClass: "artwork-ar-75",
			}),
		);
		assert.match(
			html,
			/^<div class="artwork-open artwork-open-video"><video class="artwork-photo artwork-photo-steady artwork-video artwork-ar-75"/,
		);
		assert.match(
			html,
			/<\/video><span class="artwork-open-hint artwork-video-hint">Video, no sound<\/span><\/div>$/,
		);
	});

	test("closing the viewer: the browser returns focus to its opener while that button is there; once a step to a video replaced it, to the opener there now or the video's thumbnail", () => {
		assert.deepEqual(
			focusAfterViewerClose({ openerKept: true, kind: "photo", at: 0 }),
			{ target: "browser" },
		);
		assert.deepEqual(
			focusAfterViewerClose({ openerKept: false, kind: "video", at: 2 }),
			{ target: "thumbnail", index: 2 },
		);
		assert.deepEqual(
			focusAfterViewerClose({ openerKept: false, kind: "photo", at: 1 }),
			{ target: "opener" },
		);
	});

	test("the shared rules keep a video whole in a fixed box, and its marks legible", () => {
		const rule = (selector: string) => {
			const bare = SHARED_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
			const found = new RegExp(
				`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
			).exec(bare);
			assert.ok(found, selector);
			return found[1];
		};
		assert.match(
			rule(".work-video,\n  .artwork-video"),
			/object-fit: contain;/,
		);
		const stage = rule(".work-stage .work-video");
		for (const value of [
			"position: absolute;",
			"inset: 0;",
			"inline-size: 100%;",
			"block-size: 100%;",
		]) {
			assert.ok(stage.includes(value), value);
		}
		assert.match(rule(".work-stage"), /block-size: clamp\(/);
		assert.match(rule(".artwork-angle-time"), /font-size: 0\.75rem;/);
		assert.match(
			SHARED_CSS,
			/@media \(forced-colors: active\)[\s\S]*\.artwork-angle-play path \{ fill: CanvasText; \}/,
		);
	});
});
