import assert from "node:assert/strict";
import { test } from "node:test";
import { copy } from "../../src/review/copy.ts";
import { readReviewToken } from "../../src/review/token.ts";
import {
	charCount,
	initialValues,
	mediaViews,
	orderWithLead,
	postStatusTemplate,
	submissionOf,
	uploadUrl,
	validate,
	videoProblem,
} from "../../src/review/view-model.ts";
import { MEDIA, PAGE, photo, SAVED, video } from "./fixtures.ts";

test("the token is the fragment's 43 base64url characters, nothing else", () => {
	const token = "A".repeat(43);
	assert.equal(readReviewToken(`#${token}`), token);
	assert.equal(readReviewToken(token), token);
	for (const hash of [
		"",
		"#",
		`#${"A".repeat(42)}`,
		`#${token}x`,
		`#${token.slice(1)}=`,
	]) {
		assert.equal(readReviewToken(hash), null, hash);
	}
});

test("a new page starts with the API's shown name, the project's style and placement, and both consents unticked", () => {
	const values = initialValues(PAGE);
	assert.equal(values.shownName, "Maya G.");
	assert.deepEqual(values.styles, ["fine-line"]);
	assert.equal(values.placement, "Left forearm");
	assert.equal(values.rating, 0);
	assert.equal(values.consentStudioPage, false);
	assert.equal(values.consentDiscover, false);
});

test("a saved page starts with what was saved", () => {
	const values = initialValues(SAVED);
	assert.equal(values.shownName, "Maya");
	assert.equal(values.rating, 4);
	assert.deepEqual(values.styles, ["realism"]);
	assert.equal(values.consentStudioPage, true);
});

test("checks: a rating needs words and words a rating; lengths count characters as people see them", () => {
	const base = initialValues(PAGE);
	assert.deepEqual(
		validate({ ...base, rating: 5 }, PAGE).map((p) => p.field),
		["body"],
	);
	assert.deepEqual(
		validate({ ...base, body: "x".repeat(25) }, PAGE).map((p) => p.field),
		["rating"],
	);
	assert.deepEqual(
		validate({ ...base, rating: 5, body: "न".repeat(20) }, PAGE),
		[],
	);
	assert.equal(charCount("😀".repeat(2000)), 2000);
	assert.deepEqual(
		validate({ ...base, rating: 5, body: "😀".repeat(2000) }, PAGE),
		[],
	);
	assert.deepEqual(
		validate({ ...base, rating: 5, body: "x".repeat(2001) }, PAGE).map(
			(p) => p.message,
		),
		[copy.errors.bodyLong],
	);
	assert.deepEqual(
		validate(
			{ ...base, rating: 5, body: "x".repeat(25), shownName: " " },
			PAGE,
		).map((p) => p.field),
		["shownName"],
	);
	assert.deepEqual(
		validate(
			{ ...base, rating: 5, body: "x".repeat(25), shownName: "स".repeat(41) },
			PAGE,
		).map((p) => p.field),
		["shownName"],
	);
	assert.deepEqual(
		validate(base, PAGE).map((p) => p.message),
		[copy.errors.nothing],
	);
});

test("the submit never sends a Discover consent the page didn't show", () => {
	const values = {
		...initialValues(PAGE),
		rating: 5,
		body: "x".repeat(25),
		consentDiscover: true,
	};
	assert.equal(submissionOf(values, PAGE).consentDiscover, false);
	assert.equal(submissionOf(values, SAVED).consentDiscover, true);
	assert.equal(
		submissionOf(values, PAGE).post,
		undefined,
		"no post without photos",
	);
	assert.deepEqual(submissionOf(initialValues(SAVED), SAVED).post, {
		caption: "Six weeks in",
		styles: ["realism"],
		placement: "Shoulder",
	});
});

test("a declined or unpublished post reads only 'not shown by the studio'", () => {
	assert.equal(
		postStatusTemplate({
			...(SAVED.post as NonNullable<typeof SAVED.post>),
			status: "not_shown",
		}),
		copy.postNotShown,
	);
	assert.equal(copy.postNotShown, "Not shown by the studio.");
});

test("media: only the media origin's pictures, a label per kind, a video never the main one", () => {
	const views = mediaViews(
		[
			photo("p1"),
			video("v1"),
			photo("p2", "https://evil.example.com/x.jpg"),
			video("v2", "processing"),
		],
		MEDIA,
	);
	assert.equal(views[0].label, "photo 1");
	assert.equal(views[1].label, "video 1");
	assert.equal(views[2].image, null, "another origin's picture is dropped");
	assert.match(views[0].image?.srcSet ?? "", /320w/);
	assert.equal(views[1].sources.length, 1);
	assert.equal(views[3].state, "processing");
	assert.deepEqual(orderWithLead([photo("p1"), photo("p2")], "p2"), [
		"p2",
		"p1",
	]);
	assert.equal(orderWithLead([photo("p1"), video("v1")], "v1"), null);
});

test("a picked video is checked before upload; the upload URL resolves against the API", () => {
	assert.equal(videoProblem({ type: "video/mp4", size: 1000 }), null);
	assert.equal(
		videoProblem({ type: "video/avi", size: 1000 }),
		copy.errors.videoType,
	);
	assert.equal(
		videoProblem({ type: "video/mp4", size: 101 * 1024 * 1024 }),
		copy.errors.videoSize,
	);
	assert.equal(
		uploadUrl(
			"/api/v1/tenants/x/review/videos/stage?upload=u",
			"https://api.example.com",
		),
		"https://api.example.com/api/v1/tenants/x/review/videos/stage?upload=u",
	);
	assert.equal(
		uploadUrl("https://bucket.r2.example/key?sig=1", "https://api.example.com"),
		"https://bucket.r2.example/key?sig=1",
	);
});
