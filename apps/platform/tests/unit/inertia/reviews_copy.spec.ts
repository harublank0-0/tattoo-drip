import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { parseReviewsQuery, reviewsBack } from "#modules/reviews/reviews_page";
import {
	consentText,
	dayText,
	lastDayText,
	postStatusText,
	ratingText,
	reportOutcome,
} from "#modules/reviews/studio_copy";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `ReviewsModule` below restates its shape and the inertia project type-checks the real one.
import * as reviewsModule from "../../../inertia/components/reviews.js";

type Address = {
	view: "posts" | "reviews";
	postFilter: "waiting" | "approved" | "declined";
	reviewFilter: "all" | "reported";
	artistId: string | null;
};
type ReviewsModule = {
	reviewsHref(base: string, address: Address, page?: number): string;
	viewTabs(count: number): { value: string; label: string }[];
	emptyText(view: string, postFilter: string, reviewFilter: string): string;
	mediaLabel(
		item: { kind: string; state: string },
		index: number,
		total: number,
	): string;
	linkDatesText(link: {
		madeText: string;
		expiresText: string;
		sentText: string | null;
	}): string;
	replyHint(max: number): string;
	reportLine(report: {
		reasonText: string;
		note: string | null;
		dateText: string;
		outcome: "open" | "kept" | "removed";
	}): string;
	postsProcessing(posts: { processing: boolean }[]): boolean;
	REVIEWS_INTRO: string;
};
const {
	emptyText,
	linkDatesText,
	mediaLabel,
	postsProcessing,
	replyHint,
	reportLine,
	REVIEWS_INTRO,
	reviewsHref,
	viewTabs,
} = reviewsModule as ReviewsModule;

const base = "/t/bnt/reviews";
const start: Address = {
	view: "posts",
	postFilter: "waiting",
	reviewFilter: "all",
	artistId: null,
};

test.group("Reviews page: the address", () => {
	test("only what differs from the defaults, in one order; each passes the server's back check and reads back", ({
		assert,
	}) => {
		const id = "01a1d751-a7ae-75cd-a6c3-9498b1496057";
		const cases: [Address, number, string][] = [
			[start, 1, base],
			[{ ...start, postFilter: "approved" }, 1, `${base}?status=approved`],
			[{ ...start, view: "reviews" }, 1, `${base}?view=reviews`],
			[
				{ ...start, view: "reviews", reviewFilter: "reported", artistId: id },
				3,
				`${base}?view=reviews&filter=reported&artist=${id}&page=3`,
			],
			// A post filter means nothing in the reviews view.
			[
				{ ...start, view: "reviews", postFilter: "declined" },
				1,
				`${base}?view=reviews`,
			],
		];
		for (const [address, page, href] of cases) {
			assert.equal(reviewsHref(base, address, page), href);
			assert.equal(reviewsBack(href, "bnt"), href);
			const query = Object.fromEntries(new URL(href, "http://x").searchParams);
			const parsed = parseReviewsQuery(query);
			assert.equal(parsed.view, address.view);
			assert.equal(parsed.page, page);
		}
	});

	test("the server reads anything unknown as its default, and sends a foreign back home", ({
		assert,
	}) => {
		assert.deepEqual(
			parseReviewsQuery({
				view: "x",
				status: "gone",
				filter: "?",
				artist: "1",
				page: "-2",
			}),
			{
				view: "posts",
				posts: "waiting",
				reviews: "all",
				artist: null,
				page: 1,
			},
		);
		for (const back of [
			"https://evil.example/t/bnt/reviews",
			"/t/other/reviews",
			"/t/bnt/reviewsx",
			"/t/bnt/reviews?<script>",
			undefined,
		]) {
			assert.equal(reviewsBack(back, "bnt"), base, String(back));
		}
	});
});

test.group("Reviews page: the words", () => {
	test("tabs, empty lists, media names, link dates and the reply hint", ({
		assert,
	}) => {
		assert.deepEqual(
			viewTabs(3).map(({ label }) => label),
			["Fresh ink (3)", "Reviews"],
		);
		assert.equal(viewTabs(0)[0].label, "Fresh ink");
		assert.equal(
			emptyText("posts", "waiting", "all"),
			"No Fresh ink waiting for you.",
		);
		assert.equal(
			emptyText("reviews", "waiting", "reported"),
			"No reviews you reported.",
		);
		assert.equal(
			mediaLabel({ kind: "photo", state: "ready" }, 0, 3),
			"Photo 1 of 3",
		);
		assert.equal(
			mediaLabel({ kind: "video", state: "processing" }, 2, 3),
			"Video 3 of 3, still processing",
		);
		assert.equal(
			linkDatesText({
				madeText: "1 Nov 2026",
				expiresText: "31 Oct 2027",
				sentText: null,
			}),
			"Not sent yet. Made on 1 Nov 2026, works until 31 Oct 2027.",
		);
		assert.match(
			linkDatesText({
				madeText: "1 Nov 2026",
				expiresText: "31 Oct 2027",
				sentText: "2 Nov 2026",
			}),
			/^Sent on 2 Nov 2026\./,
		);
		assert.include(replyHint(1000), "up to 1,000 characters");
	});

	test("the server's statuses, consents, ratings and days", ({ assert }) => {
		const post = { consentStudioPage: false, consentDiscover: false };
		assert.equal(
			postStatusText({ ...post, status: "waiting" }),
			"Waiting for you",
		);
		assert.equal(
			postStatusText({ ...post, status: "approved" }),
			"Approved: the client allowed no page yet",
		);
		assert.equal(
			postStatusText({ ...post, consentDiscover: true, status: "approved" }),
			"Approved: shown where the client allowed",
		);
		assert.equal(consentText(post), "Nowhere public: kept for you");
		assert.equal(
			consentText({ consentStudioPage: true, consentDiscover: true }),
			"Your page and TattooDrip Discover",
		);
		assert.equal(ratingText(4), "4 out of 5 stars");
		const at = DateTime.fromISO("2026-11-12T20:00:00Z");
		assert.equal(dayText(at, "Asia/Kathmandu"), "13 Nov 2026");
		// A link made then expires twelve months later at the same instant: its last day is the day before.
		assert.equal(
			lastDayText(
				DateTime.fromISO("2027-11-13T00:00:00", { zone: "Asia/Kathmandu" }),
				"Asia/Kathmandu",
			),
			"12 Nov 2027",
		);
	});
});

test.group("Reviews page: takedowns, reports and processing", () => {
	test("a taken-down post says so whatever its decision; a report says what TattooDrip did", ({
		assert,
	}) => {
		for (const status of ["waiting", "approved", "declined"] as const) {
			assert.equal(
				postStatusText({
					status,
					consentStudioPage: true,
					consentDiscover: false,
					takenDownAt: new Date(),
				}),
				"Taken down by TattooDrip",
			);
		}
		const at = new Date();
		assert.isNull(
			reportOutcome({
				reportedAt: null,
				reportResolvedAt: null,
				takenDownAt: at,
			}),
		);
		assert.equal(
			reportOutcome({
				reportedAt: at,
				reportResolvedAt: null,
				takenDownAt: null,
			}),
			"open",
		);
		assert.equal(
			reportOutcome({
				reportedAt: at,
				reportResolvedAt: at,
				takenDownAt: null,
			}),
			"kept",
		);
		// The takedown closed the report: it says removed, never "kept it up".
		assert.equal(
			reportOutcome({ reportedAt: at, reportResolvedAt: at, takenDownAt: at }),
			"removed",
		);
		const report = {
			reasonText: "Not a client",
			note: null,
			dateText: "14 Nov 2026",
		};
		assert.equal(
			reportLine({ ...report, outcome: "open" }),
			"Reported on 14 Nov 2026. Reason: Not a client. TattooDrip will decide; the review stays up until then.",
		);
		assert.equal(
			reportLine({ ...report, note: "Never here.", outcome: "kept" }),
			"Reported on 14 Nov 2026. Reason: Not a client. Your note: “Never here.” TattooDrip kept it up.",
		);
		assert.match(
			reportLine({ ...report, outcome: "removed" }),
			/TattooDrip took it down\.$/,
		);
		assert.isTrue(
			postsProcessing([{ processing: false }, { processing: true }]),
		);
		assert.isFalse(postsProcessing([]));
		assert.notInclude(REVIEWS_INTRO, "reply once");
		assert.equal(
			emptyText("posts", "declined", "all"),
			"No declined, unpublished or taken-down Fresh ink.",
		);
	});
});
