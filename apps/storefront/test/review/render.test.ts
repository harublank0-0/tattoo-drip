import assert from "node:assert/strict";
import { test } from "node:test";
import { createTattooClient, type ReviewPage } from "@tattoo-drip/sdk";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ReviewForHash,
	ReviewLoaded,
	ReviewScreen,
} from "../../src/review/components/review-screen.tsx";
import { attr, hrefs, tags, textOf } from "../deposit/html.ts";
import { CONNECTION, PAGE, SAVED, SHELL, TOKEN } from "./fixtures.ts";
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
	// Not offered for the main photo nor for a video.
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
