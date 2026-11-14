import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import {
	assertInternalLinksExist,
	type Discover,
	skip,
	startDiscover,
	text,
} from "./built-server.ts";
import { type StubApi, stubApi } from "./stub-api.ts";

/**
 * Reviews and Fresh ink on the built server (slice 4; needs `pnpm build`):
 * the profiles' Reviews and Fresh ink sections, the average only from 3,
 * stars said in words, plain bidi-safe text, the `/fresh-ink` feed, and
 * where the review JSON-LD may appear (a studio's profile only, with
 * indexing on), against the stub API (test/stub-api.ts: a studio has four
 * reviews, "4.3 from 4"; an artist two; every profile two posts).
 */

const html = async (response: Response) => response.text();

/** The page's JSON-LD graph nodes, or none. */
function nodes(page: string): Record<string, unknown>[] {
	return [
		...page.matchAll(
			/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
		),
	].flatMap((match) => JSON.parse(match[1] as string)["@graph"] ?? []);
}

describe("Reviews and Fresh ink on the built server", { skip }, () => {
	let api: StubApi;
	let discover: Discover;
	before(async () => {
		api = await stubApi(20);
		discover = await startDiscover(api.url, { DISCOVER_INDEXING: "on" });
	});
	beforeEach(() => {
		api.requests.length = 0;
		api.scenario.fail.clear();
		api.scenario.hidden.clear();
	});
	after(() => {
		discover?.child.kill();
		api?.close();
	});

	test("a studio: its reviews with the average from 3, stars in words, the reply, plain bidi-safe text", async () => {
		const response = await discover.get("/studios/stub-studio-1");
		assert.equal(response.status, 200);
		const page = await html(response);
		assert.match(page, /<h2[^>]*>Reviews of Stub Studio 1<\/h2>/);
		assert.match(text(page), /4\.3/);
		assert.match(text(page), /from 4 reviews/);
		assert.match(text(page), /Rated 4\.3 out of 5/);
		for (const words of ["5 out of 5", "4 out of 5", "3 out of 5"])
			assert.match(text(page), new RegExp(words));
		// Stars are decoration (the words carry the rating); the average fills 4, never 5.
		assert.match(page, /<span aria-hidden="true" class="inline-flex gap-0\.5/);
		assert.match(text(page), /Reply from Stub Studio 1/);
		assert.match(text(page), /Thank you for coming in!/);
		// The client's words are text, never markup, in their own direction.
		assert.match(
			page,
			/dir="auto">Healed evenly\.\n\nWould come back &lt;b&gt;again&lt;\/b&gt;\.<\/p>/,
		);
		assert.match(page, /<bdi[^>]*>سارا م\.<\/bdi>/);
		// Its Fresh ink: tiles that open their viewer, captions in <bdi>.
		assert.match(
			page,
			/<h2[^>]*>Healed work from Stub Studio 1(&#x27;|')s clients<\/h2>/,
		);
		assert.match(page, /aria-haspopup="dialog"/);
		assert.match(page, /2 photos and a video/);
		// The studio is in a market (NP): its own country, not the visitor's.
		assert.match(page, /href="\/fresh-ink\?country=NP"/);
		// JSON-LD: the TattooParlor with AggregateRating and the shown reviews.
		const parlor = nodes(page).find((node) => node["@type"] === "TattooParlor");
		assert.ok(parlor, "a TattooParlor node");
		assert.deepEqual(parlor.aggregateRating, {
			"@type": "AggregateRating",
			ratingValue: 4.3,
			reviewCount: 4,
			bestRating: 5,
			worstRating: 1,
		});
		assert.equal((parlor.review as unknown[]).length, 4);
		assertInternalLinksExist(page);
	});

	test("an artist below the threshold: the reviews without an average, and no review JSON-LD", async () => {
		const response = await discover.get(
			"/studios/stub-studio-1/artists/stub-artist-1",
		);
		assert.equal(response.status, 200);
		const page = await html(response);
		assert.match(page, /<h2[^>]*>Reviews of Stub Artist 1<\/h2>/);
		assert.match(text(page), /2 out of 5/);
		assert.doesNotMatch(text(page), /from \d+ reviews/);
		assert.doesNotMatch(
			text(page),
			/Tattoo by/,
			"an artist's own reviews don't name them again",
		);
		const all = JSON.stringify(nodes(page));
		assert.doesNotMatch(all, /AggregateRating|"Review"/);
		assert.match(all, /"Person"/);
	});

	test("reviews and Fresh ink that fail or are empty render nothing (the flag off answers empty)", async () => {
		api.scenario.fail.add("profile-reviews");
		api.scenario.fail.add("profile-fresh-ink");
		const response = await discover.get("/studios/stub-studio-1");
		assert.equal(response.status, 200, "optional reads never fail the page");
		const page = await html(response);
		assert.doesNotMatch(page, /Reviews of|Healed work from|Fresh ink/);
		assert.doesNotMatch(JSON.stringify(nodes(page)), /AggregateRating/);
	});

	test("the feed: tiles with credits to the artist's and the studio's profiles, booking only from the API, no rating markup", async () => {
		const response = await discover.get("/fresh-ink");
		assert.equal(response.status, 200);
		assert.equal(
			response.headers.get("x-robots-tag"),
			null,
			"populated and bare: indexable",
		);
		const page = await html(response);
		assert.equal(page.match(/<h1[\s>]/g)?.length, 1);
		assert.match(page, /<h1[^>]*>Fresh ink<\/h1>/);
		assert.match(page, /href="\/studios\/stub-studio-1"/);
		assert.match(
			page,
			/href="\/studios\/stub-studio-1\/artists\/stub-artist-1"/,
		);
		assert.match(page, /alt="Healed tattoo by Stub Artist 1"/);
		assert.match(page, /alt="Koi on the forearm, healed"/);
		assert.match(page, /<label[^>]*>Style<\/label>/);
		const all = JSON.stringify(nodes(page));
		assert.match(all, /BreadcrumbList/);
		assert.doesNotMatch(all, /AggregateRating|"Review"/);
		assert.ok(
			api.requests.some((url) =>
				/\/discover\/fresh-ink\?country=NP&limit=24/.test(url),
			),
			"the page's country is in the read",
		);
		assertInternalLinksExist(page);
	});

	test("an empty feed is its empty state and noindex; a filter is noindex too", async () => {
		const empty = await discover.get("/fresh-ink?country=US");
		assert.equal(empty.status, 200);
		assert.match(empty.headers.get("x-robots-tag") ?? "", /noindex/);
		assert.match(
			text(await html(empty)),
			/No Fresh ink from United States yet/,
		);
		api.scenario.hidden = new Set(
			Array.from({ length: 20 }, (_, index) => `stub-studio-${index}`),
		);
		const none = await discover.get("/fresh-ink");
		assert.equal(none.status, 200);
		assert.match(none.headers.get("x-robots-tag") ?? "", /noindex/);
		const styled = await discover.get("/fresh-ink?style=blackwork");
		assert.match(styled.headers.get("x-robots-tag") ?? "", /noindex/);
	});
});
