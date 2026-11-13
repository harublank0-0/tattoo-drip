import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createTattooClient,
	type ReviewPage,
	TattooApiError,
} from "@tattoo-drip/sdk";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	CountedText,
	StarRating,
} from "../../src/review/components/fields.tsx";
import { MediaTray } from "../../src/review/components/media-tray.tsx";
import { DeleteControl } from "../../src/review/components/review-form.tsx";
import {
	ReviewForHash,
	ReviewLoaded,
	ReviewScreen,
	screenOf,
} from "../../src/review/components/review-screen.tsx";
import { mediaViews } from "../../src/review/view-model.ts";
import { attr, hrefs, tags, textOf } from "../deposit/html.ts";
import {
	CONNECTION,
	MEDIA,
	PAGE,
	photo,
	SAVED,
	SHELL,
	TOKEN,
	video,
} from "./fixtures.ts";
import { renderWithReview } from "./providers.tsx";

Object.assign(globalThis, { React });

const client = createTattooClient({
	baseUrl: "https://api.example.com",
	tenant: "black-needle",
	fetch: (() => {
		throw new Error("a render test fetches nothing");
	}) as typeof fetch,
});

/** The page once read: `page` is in the query's cache, so nothing is fetched. */
function loaded(page: ReviewPage): string {
	return renderWithReview(
		client,
		TOKEN,
		page,
		createElement(ReviewLoaded, {
			token: TOKEN,
			shell: SHELL,
			connection: CONNECTION,
		}),
	);
}

test("the server renders the shell only: the studio, one h1, a busy skeleton, no form, no token", () => {
	const html = renderToStaticMarkup(
		createElement(ReviewScreen, { shell: SHELL, connection: CONNECTION }),
	);
	assert.equal(tags(html, "h1").length, 1);
	assert.match(textOf(html), /How did it heal\?/);
	assert.match(html, /aria-busy="true"/);
	assert.doesNotMatch(html, /<form/);
	assert.doesNotMatch(html, new RegExp(TOKEN));
});

test("a missing or malformed token is the dead link with the studio's contact links, and no content", () => {
	for (const hash of ["", "#", "#abc", `#${"x".repeat(42)}`]) {
		const html = renderToStaticMarkup(
			createElement(ReviewForHash, {
				hash,
				shell: SHELL,
				connection: CONNECTION,
			}),
		);
		assert.match(textOf(html), /This link no longer works/, hash);
		assert.match(textOf(html), /Ask Black Needle to send you a new link\./);
		assert.deepEqual(hrefs(html), [
			"https://instagram.com/blackneedle",
			"https://wa.me/9779812345678",
		]);
		assert.match(html, /role="alert"/);
		assert.doesNotMatch(html, /<form/);
	}
});

test("before submit: a radio group of five labelled stars, the counted review, unticked consents, the default name", () => {
	const html = loaded(PAGE);
	assert.match(textOf(html), /How did it heal\?/);
	assert.match(textOf(html), /Tattooed by Sita Rai on 1 Oct 2026/);
	const radios = tags(html, "input").filter(
		(tag) => attr(tag, "type") === "radio",
	);
	assert.equal(radios.length, 5);
	for (const radio of radios) {
		assert.equal(attr(radio, "name"), "rating");
		assert.equal(
			/ checked=""/.test(radio),
			false,
			"no star is chosen for the client",
		);
	}
	assert.match(textOf(html), /1 star, Poor/);
	assert.match(textOf(html), /5 stars, Excellent/);
	assert.match(html, /<legend[^>]*>Your rating<\/legend>/);

	const [body] = tags(html, "textarea");
	assert.equal(attr(body, "id"), "review-body");
	assert.equal(
		attr(body, "aria-describedby"),
		"review-body-hint review-body-count",
	);
	assert.match(textOf(html), /0 of 2000 characters/);

	const boxes = tags(html, "input").filter(
		(tag) => attr(tag, "type") === "checkbox",
	);
	const consents = boxes.filter((tag) =>
		/review-consent/.test(attr(tag, "id") ?? ""),
	);
	assert.deepEqual(
		consents.map((tag) => attr(tag, "id")),
		["review-consent-studio"],
	);
	assert.ok(
		consents.every((tag) => !/ checked=""/.test(tag)),
		"unticked",
	);
	assert.match(textOf(html), /Show on Black Needle's page/);
	assert.doesNotMatch(
		textOf(html),
		/TattooDrip Discover/,
		"not while the studio isn't listed",
	);

	const name = tags(html, "input").find(
		(tag) => attr(tag, "id") === "review-name",
	);
	assert.equal(attr(name ?? "", "value"), "Maya G.");
	assert.match(
		html,
		/<label[^>]*for="review-name"[^>]*>Your name as shown<\/label>/,
	);
	// Every link is real: none starts with "#" (it would replace the token).
	assert.ok(hrefs(html).every((href) => !href.startsWith("#")));
	assert.doesNotMatch(html, new RegExp(TOKEN));
});

test("after submit: the thanks heading, the saved values, both consents while listed, delete buttons, previews", () => {
	const html = loaded(SAVED);
	assert.match(textOf(html), /Thanks for telling Black Needle/);
	assert.match(textOf(html), /Show on TattooDrip Discover/);
	assert.match(textOf(html), /Delete my review/);
	assert.match(textOf(html), /Delete my post/);
	assert.match(textOf(html), /Waiting for Black Needle to check it\./);
	const checked = tags(html, "input").filter((tag) => / checked=""/.test(tag));
	assert.ok(checked.some((tag) => attr(tag, "id") === "review-rating-4"));
	assert.ok(checked.some((tag) => attr(tag, "id") === "review-consent-studio"));
	// The photo with its copies, the video muted and inline.
	const [img] = tags(html, "img");
	assert.equal(attr(img, "alt"), "Your photo 1");
	assert.equal(attr(img, "referrerpolicy"), "no-referrer");
	const [videoTag] = tags(html, "video");
	assert.match(videoTag, / muted=""/);
	assert.match(videoTag, / playsInline=""/i);
	assert.match(html, /aria-label="Remove video 1"/);
	// Not offered for the main photo nor for a video: only photo 2 would get one.
	assert.equal((textOf(html).match(/Make it the main photo/g) ?? []).length, 0);
});

test("a taken-down review shows its fixed sentence instead of the form's review fields", () => {
	const page: ReviewPage = {
		...SAVED,
		review: {
			...(SAVED.review as NonNullable<ReviewPage["review"]>),
			takenDown: {
				reason: "personal_data",
				sentence:
					"TattooDrip took this down because it showed someone's personal details.",
				at: "2026-11-02T00:00:00.000Z",
			},
		},
	};
	const html = loaded(page);
	assert.match(
		textOf(html),
		/TattooDrip took this down because it showed someone's personal details\./,
	);
	assert.equal(
		tags(html, "input").filter((tag) => attr(tag, "type") === "radio").length,
		0,
	);
	assert.match(textOf(html), /Delete my review/);
});

test("a declined post: 'Not shown by the studio.', no pickers, still deletable", () => {
	const page: ReviewPage = {
		...SAVED,
		post: {
			...(SAVED.post as NonNullable<ReviewPage["post"]>),
			status: "not_shown",
			editable: false,
		},
	};
	const html = loaded(page);
	assert.match(textOf(html), /Not shown by the studio\./);
	assert.doesNotMatch(html, /type="file"/);
	assert.doesNotMatch(textOf(html), /Remove/);
	assert.match(textOf(html), /Delete my post/);
});

const POST = SAVED.post as NonNullable<ReviewPage["post"]>;

test("a saved review with a draft post says the post isn't sent yet", () => {
	const html = loaded({ ...SAVED, post: { ...POST, status: "draft" } });
	assert.match(
		textOf(html),
		/Not sent yet: press Save to send it to Black Needle\./,
	);
});

test("an approved post warns before any change that the studio checks it again", () => {
	const html = loaded({ ...SAVED, post: { ...POST, status: "approved" } });
	assert.match(textOf(html), /Shown by Black Needle where you allowed\./);
	assert.match(
		textOf(html),
		/If you change it, Black Needle checks it again\./,
	);
});

test("a taken-down post's sentence replaces its status line", () => {
	const sentence = "TattooDrip took this down because it contained a threat.";
	const html = loaded({
		...SAVED,
		post: {
			...POST,
			status: "approved",
			editable: false,
			takenDown: {
				reason: "threats",
				sentence,
				at: "2026-11-02T00:00:00.000Z",
			},
		},
	});
	assert.match(textOf(html), new RegExp(sentence));
	assert.doesNotMatch(textOf(html), /Shown by Black Needle/);
	assert.doesNotMatch(textOf(html), /checks it again/);
});

test("a new review or post the API blocks shows why instead of the fields", () => {
	const html = loaded({
		...PAGE,
		blocks: { review: "taken_down", post: "post_limit" },
	});
	assert.match(
		textOf(html),
		/This was taken down by TattooDrip\. Contact the studio\./,
	);
	assert.match(textOf(html), /This tattoo already had two posts\./);
	assert.equal(
		tags(html, "input").filter((tag) => attr(tag, "type") === "radio").length,
		0,
	);
	assert.doesNotMatch(html, /type="file"/);
});

test("the Discover box shows while unlisted only if the client ticked it, so it can be unticked", () => {
	const ticked = loaded({
		...SAVED,
		studio: { name: "Black Needle", onDiscover: false },
		review: {
			...(SAVED.review as NonNullable<ReviewPage["review"]>),
			consentDiscover: true,
		},
	});
	assert.match(textOf(ticked), /Show on TattooDrip Discover/);
	const unticked = loaded({
		...SAVED,
		studio: { name: "Black Needle", onDiscover: false },
	});
	assert.doesNotMatch(textOf(unticked), /Show on TattooDrip Discover/);
});

test("a field's error: aria-invalid, linked by aria-describedby; the count is not a live region", () => {
	const html = renderToStaticMarkup(
		createElement(CountedText, {
			id: "review-body",
			label: "Your review",
			hint: "At least 20 characters.",
			value: "short",
			max: 2000,
			error: "Write at least 20 characters.",
			onChange: () => undefined,
		}),
	);
	const [area] = tags(html, "textarea");
	assert.equal(attr(area, "aria-invalid"), "true");
	assert.equal(
		attr(area, "aria-describedby"),
		"review-body-hint review-body-count review-body-error",
	);
	assert.match(
		html,
		/<p class="deposit-field-error" id="review-body-error">Write at least 20 characters\.<\/p>/,
	);
	assert.doesNotMatch(html, /aria-live/);
	const stars = renderToStaticMarkup(
		createElement(StarRating, {
			value: 0,
			onChange: () => undefined,
			error: "Choose a rating from 1 to 5 stars.",
		}),
	);
	assert.equal(
		attr(tags(stars, "fieldset")[0], "aria-describedby"),
		"review-rating-error",
	);
	assert.ok(
		tags(stars, "input").every((tag) => attr(tag, "aria-invalid") === "true"),
	);
	const fine = renderToStaticMarkup(
		createElement(StarRating, {
			value: 4,
			onChange: () => undefined,
			error: null,
		}),
	);
	assert.doesNotMatch(fine, /aria-invalid|review-rating-error/);
});

test("the delete confirm: a focusable question, Yes and Keep it", () => {
	const ref = { current: null };
	const asking = renderToStaticMarkup(
		createElement(DeleteControl, {
			what: "review",
			label: "Delete my review",
			confirming: true,
			confirmRef: ref,
			onAsk: () => undefined,
			onCancel: () => undefined,
			onConfirm: () => undefined,
		}),
	);
	assert.match(asking, /<legend class="sr-only">Delete my review<\/legend>/);
	assert.match(asking, /<p tabindex="-1">Delete it for good\?<\/p>/i);
	assert.match(textOf(asking), /Yes, deleteKeep it/);
	const resting = renderToStaticMarkup(
		createElement(DeleteControl, {
			what: "review",
			label: "Delete my review",
			confirming: false,
			confirmRef: ref,
			onAsk: () => undefined,
			onCancel: () => undefined,
			onConfirm: () => undefined,
		}),
	);
	assert.match(resting, /data-delete="review"/);
});

test("each photo's main-photo button names it; Remove buttons are marked for focus", () => {
	const items = mediaViews(
		[photo("a"), photo("b"), video("v"), photo("c")],
		[MEDIA],
	);
	const html = renderToStaticMarkup(
		createElement(MediaTray, {
			items,
			pending: [],
			editable: true,
			busy: false,
			error: null,
			onPhotos: () => undefined,
			onVideo: () => undefined,
			onRemove: () => undefined,
			onMakeMain: () => undefined,
		}),
	);
	assert.match(textOf(html), /Make photo 2 the main photo/);
	assert.match(textOf(html), /Make photo 3 the main photo/);
	assert.doesNotMatch(textOf(html), /Make photo 1|Make video/);
	assert.equal((html.match(/data-remove=""/g) ?? []).length, 4);
});

test("offline, a rate limit and a dead link are states of their own, never loading for ever", () => {
	assert.equal(
		screenOf({ data: undefined, error: null, fetchStatus: "paused" }),
		"offline",
	);
	assert.equal(
		screenOf({ data: undefined, error: null, fetchStatus: "fetching" }),
		"loading",
	);
	const limited = new TattooApiError(
		429,
		{ code: "rate_limited", message: "" },
		{ retryAfter: 60 },
	);
	assert.equal(
		screenOf({ data: undefined, error: limited, fetchStatus: "idle" }),
		"limited",
	);
	assert.equal(
		screenOf({ data: PAGE, error: limited, fetchStatus: "idle" }),
		"page",
	);
	const gone = new TattooApiError(404, { code: "not_found", message: "" });
	assert.equal(
		screenOf({ data: PAGE, error: gone, fetchStatus: "idle" }),
		"dead",
	);
});
