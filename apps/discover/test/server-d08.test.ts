import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import {
	assertInternalLinksExist,
	type Discover,
	SITE,
	skip,
	startDiscover,
	text,
} from "./built-server.ts";
import { STUB_REF, type StubApi, stubApi } from "./stub-api.ts";

/**
 * D08 on the built server (needs `pnpm build`): the studio, studio-artist
 * and independent-artist profiles against the stub API (markets NP and IN,
 * geolocation from X-Discover-Country): what they render, their one read,
 * their 404s and 301s, the booking hand-off and its referral, and their
 * head tags. The stub's 404 rules mirror the API's (test/stub-api.ts);
 * the platform's own are tested in apps/platform
 * tests/functional/api/discover.spec.ts.
 */

const html = async (response: Response) => response.text();

/** Every `href` on a page, entities decoded. */
function hrefs(page: string): string[] {
	return [...page.matchAll(/href="([^"]+)"/g)].map((match) =>
		(match[1] as string).replace(/&amp;/g, "&"),
	);
}

/** The href of the first link whose text starts with `label`. */
function linkNamed(page: string, label: RegExp): string | undefined {
	const match = [
		...page.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g),
	].find((each) => label.test(text(each[2] as string).trim()));
	return match ? (match[1] as string).replace(/&amp;/g, "&") : undefined;
}

/** The API reads a page made, by path (query included). */
const reads = (api: StubApi) =>
	api.requests.map((url) => url.replace("/api/v1/discover", ""));

/** Words for data the API never publishes: none may reach a profile's HTML. */
const PRIVATE_KEYS = [
	"contactPhone",
	"contactEmail",
	'"email"',
	'"phone"',
	'"address"',
	"tenant_id",
	"tenantId",
	"suspension",
	"consent",
	"discovery_listed",
	"ownerId",
	"userId",
];

describe("D08 profiles on the built server", { skip }, () => {
	let api: StubApi;
	let discover: Discover;
	before(async () => {
		api = await stubApi(20);
		discover = await startDiscover(api.url, {
			DISCOVER_MARKETS: "NP,IN",
			DISCOVER_GEO_HEADER: "X-Discover-Country",
		});
	});
	beforeEach(() => {
		api.requests.length = 0;
		api.scenario.count = 20;
		api.scenario.fail.clear();
		api.scenario.hidden.clear();
		api.scenario.links = {};
	});
	after(() => {
		discover?.child.kill();
		api?.close();
	});

	test("a studio: one read, identity, cover first, about, portfolio, artists, booking, related", async () => {
		const response = await discover.get("/studios/stub-studio-1");
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("cache-control"), "private, no-store");
		assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
		const page = await html(response);
		// One read, by the address's slug, with no country.
		assert.deepEqual(reads(api), ["/studios/stub-studio-1"]);
		// One h1, the breadcrumbs, the place from the API.
		assert.equal(page.match(/<h1[\s>]/g)?.length, 1);
		assert.match(page, /<h1[^>]*>Stub Studio 1<\/h1>/);
		assert.match(page, /<nav aria-label="Breadcrumb">/);
		assert.match(page, /Kathmandu, Bagmati, Nepal/);
		// The cover loads first, sized; the portfolio lazily at true proportions.
		assert.match(
			page,
			/<img src="http:\/\/media\.test\/cover-1\.jpg"[^>]*width="1600" height="900" alt="Stub Studio 1(&#x27;|')s studio" loading="eager"[^>]*fetchPriority="high"/,
		);
		assert.equal(page.match(/<img [^>]*fetchPriority="high"/g)?.length, 1);
		assert.match(page, /style="aspect-ratio:1200 \/ 1500"/);
		assert.match(page, /style="aspect-ratio:1200 \/ 900"/);
		assert.match(page, /loading="lazy"/);
		// Plain text: the intro's markup is text, its paragraphs kept.
		assert.match(
			page,
			/<p class="whitespace-pre-line">Stub intro about the studio\.<\/p>/,
		);
		assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
		// Public links: https only (the stub's javascript: website is dropped).
		assert.match(
			page,
			/href="https:\/\/instagram\.com\/stub-studio-1"[^>]*><svg[^>]*aria-hidden="true"[^>]*><path[^>]*><\/path><\/svg><span>Instagram<\/span>/,
		);
		// (it is in the dehydrated API answer, as data, never as a link).
		assert.ok(!hrefs(page).some((href) => href.startsWith("javascript:")));
		// Styles to their pages; artists, work-first, to their profiles; the
		// portfolio credits each photo's artist and links their profile.
		assert.match(page, /href="\/styles\/fine-line"/);
		for (const artist of ["stub-artist-1", "crew-1-a", "crew-1-b"])
			assert.match(
				page,
				new RegExp(`href="/studios/stub-studio-1/artists/${artist}"`),
			);
		assert.match(text(page), /Stub Crew 1A · Realism · Healed/);
		// Booking: a request (not "book now") on the studio's own /book, with
		// the API's referral; the studio's own site beside it.
		assert.doesNotMatch(text(page), /book now|instant booking available/i);
		assert.equal(
			linkNamed(page, /^Request a session/),
			`http://stub-studio-1.localhost:3000/book?ref=${STUB_REF}`,
		);
		assert.equal(
			linkNamed(page, /^Visit studio site/),
			"http://stub-studio-1.localhost:3000/",
		);
		assert.match(page, /It(&#x27;|')s a request, not an instant booking/);
		// The phone's booking bar, last.
		assert.match(page, /data-booking-bar=""/);
		// Related, by the studio's own place (a market: its location pages).
		assert.match(page, /href="\/locations\/nepal\/kathmandu"/);
		assert.match(page, /href="\/explore\/studios">Back to studios/);
		assertInternalLinksExist(page);
	});

	test("head: title, description, path-only canonical on DISCOVER_URL, the cover as social image", async () => {
		const page = await html(
			await discover.get("/studios/stub-studio-1?utm_source=x"),
		);
		assert.match(
			page,
			/<title>Stub Studio 1 — Tattoo studio in Kathmandu, Nepal \| Tattoo Drip<\/title>/,
		);
		assert.match(
			page,
			/<meta name="description" content="Stub intro about the studio\. We work by appointment\. &lt;script&gt;alert\(1\)&lt;\/script&gt;"\/>/,
		);
		assert.match(
			page,
			new RegExp(
				`<link rel="canonical" href="${SITE}/studios/stub-studio-1"/>`,
			),
		);
		// Never the storefront as canonical: the profile is its own summary.
		assert.doesNotMatch(page, /rel="canonical" href="http:\/\/stub-studio/);
		assert.match(
			page,
			/<meta property="og:image" content="http:\/\/media\.test\/cover-1\.jpg"\/>/,
		);
		assert.match(
			page,
			/<meta name="twitter:card" content="summary_large_image"\/>/,
		);
		// A studio without a cover shares its newest photo.
		const other = await html(await discover.get("/studios/stub-studio-2"));
		assert.match(
			other,
			/<meta property="og:image" content="http:\/\/media\.test\/work-/,
		);
		assert.match(
			other,
			/listed on Tattoo Drip\. See recent work by its artists/,
		);
	});

	test("a studio's artist: the profile and the studio's other artists, read in parallel", async () => {
		const response = await discover.get(
			"/studios/stub-studio-1/artists/crew-1-a",
		);
		assert.equal(response.status, 200);
		const page = await html(response);
		assert.deepEqual(reads(api).sort(), [
			"/studios/stub-studio-1/artists",
			"/studios/stub-studio-1/artists/crew-1-a",
		]);
		assert.match(page, /<h1[^>]*>Stub Crew 1A<\/h1>/);
		assert.match(
			page,
			/<title>Stub Crew 1A — Tattoo artist at Stub Studio 1 in Kathmandu \| Tattoo Drip<\/title>/,
		);
		// Affiliation back to the studio's profile, in the breadcrumbs too.
		assert.match(
			page,
			/<a [^>]*href="\/studios\/stub-studio-1"[^>]*>Stub Studio 1<\/a>/,
		);
		// The request names this artist, by their slug, with the referral.
		assert.equal(
			linkNamed(page, /^Request with Stub Crew 1A/),
			`http://stub-studio-1.localhost:3000/book?artist=crew-1-a&ref=${STUB_REF}`,
		);
		assert.equal(
			linkNamed(page, /^View on studio site/),
			"http://stub-studio-1.localhost:3000/artists/crew-1-a",
		);
		// Their portfolio (no self-links) and their studio's other artists.
		assert.match(text(page), /Work by Stub Crew 1A/);
		assert.match(text(page), /More artists at Stub Studio 1/);
		assert.match(page, /href="\/studios\/stub-studio-1\/artists\/crew-1-b"/);
		assert.match(
			page,
			/href="\/studios\/stub-studio-1\/artists\/stub-artist-1"/,
		);
		assert.doesNotMatch(
			page,
			/More artists[\s\S]*href="\/studios\/stub-studio-1\/artists\/crew-1-a"/,
		);
		assert.match(
			page,
			/<meta property="og:image" content="http:\/\/media\.test\/work-crew-1-a/,
		);
		assertInternalLinksExist(page);
	});

	test("the studio's other artists are optional: their failure only hides that section", async () => {
		api.scenario.fail.add("studio-artists");
		const response = await discover.get(
			"/studios/stub-studio-1/artists/crew-1-a",
		);
		assert.equal(response.status, 200);
		const page = await html(response);
		assert.match(page, /<h1[^>]*>Stub Crew 1A<\/h1>/);
		assert.doesNotMatch(text(page), /More artists at/);
	});

	test("two artists named maya at two studios are two profiles", async () => {
		const five = await html(
			await discover.get("/studios/stub-studio-5/artists/maya"),
		);
		const six = await html(
			await discover.get("/studios/stub-studio-6/artists/maya"),
		);
		assert.match(five, /<h1[^>]*>Stub Artist 5<\/h1>/);
		assert.match(six, /<h1[^>]*>Stub Artist 6<\/h1>/);
		assert.equal(
			linkNamed(five, /^Request with/),
			`http://stub-studio-5.localhost:3000/book?artist=maya&ref=${STUB_REF}`,
		);
		assert.equal(
			linkNamed(six, /^Request with/),
			`http://stub-studio-6.localhost:3000/book?artist=maya&ref=${STUB_REF}`,
		);
	});

	test("an independent artist: by their business's slug, their own site, no studio", async () => {
		const response = await discover.get("/artists/stub-solo-3");
		assert.equal(response.status, 200);
		const page = await html(response);
		assert.deepEqual(reads(api), ["/artists/stub-solo-3"]);
		assert.match(page, /<h1[^>]*>Stub Artist 3<\/h1>/);
		assert.match(page, /Independent tattoo artist/);
		assert.match(text(page), /Works independently · New Delhi, India/);
		assert.doesNotMatch(page, /href="\/studios\//);
		assert.equal(
			linkNamed(page, /^Request with Stub Artist 3/),
			`http://stub-solo-3.localhost:3000/book?artist=stub-artist-3&ref=${STUB_REF}`,
		);
		assert.equal(
			linkNamed(page, /^Visit their site/),
			"http://stub-solo-3.localhost:3000/artists/stub-artist-3",
		);
		// India is a market here (NP,IN): its location pages.
		assert.match(page, /href="\/locations\/india\/new-delhi"/);
		assert.match(
			page,
			/<p class="whitespace-pre-line">Second &lt;i&gt;line&lt;\/i&gt;\.<\/p>/,
		);
		assertInternalLinksExist(page);
	});

	test("profiles are global: the visitor's country neither filters nor redirects them", async () => {
		// Stub Studio 3 is in New Delhi; the visitor is Nepal's by cookie and geolocation.
		const response = await discover.get("/studios/stub-studio-3", {
			headers: { Cookie: "td_country=NP", "X-Discover-Country": "NP" },
			redirect: "manual",
		});
		assert.equal(response.status, 200);
		const page = await html(response);
		assert.deepEqual(reads(api), ["/studios/stub-studio-3"]);
		assert.match(page, /New Delhi, India/);
		// No link on the profile carries a country it didn't ask for.
		for (const href of hrefs(page).filter((each) =>
			/^\/(studios|artists)\//.test(each),
		))
			assert.doesNotMatch(href, /country=/);
		const india = await discover.get("/studios/stub-studio-1", {
			headers: { "X-Discover-Country": "IN" },
			redirect: "manual",
		});
		assert.equal(india.status, 200);
		assert.match(await html(india), /Kathmandu, Bagmati, Nepal/);
	});

	test("not shown is a 404 with no hint: unknown, hidden, the wrong kind, another studio's, malformed", async () => {
		api.scenario.hidden.add("stub-studio-2");
		api.scenario.hidden.add("stub-studio-1/crew-1-b");
		api.scenario.hidden.add("stub-solo-7");
		for (const path of [
			"/studios/nope-studio",
			"/studios/stub-studio-2",
			"/studios/stub-studio-2/artists/stub-artist-2",
			"/studios/stub-studio-1/artists/crew-1-b",
			"/studios/stub-studio-1/artists/stub-artist-2",
			"/studios/stub-solo-7",
			"/studios/stub-solo-3/artists/stub-artist-3",
			"/artists/stub-studio-1",
			"/artists/stub-solo-7",
			"/artists/nope-solo",
			"/studios/Stub-Studio-1",
			"/studios/a",
			"/artists/x%20y",
		]) {
			const response = await discover.get(path, { redirect: "manual" });
			assert.equal(response.status, 404, path);
			assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
			const page = await html(response);
			assert.match(page, /<title>Page not found \| Tattoo Drip<\/title>/, path);
			assert.match(page, /<meta name="robots" content="noindex, nofollow"\/>/);
			assert.match(page, /no longer listed on Discover/);
			// Nothing about what was asked for: no name, no image (only the
			// brand's card), no booking.
			assert.doesNotMatch(
				page,
				/og:image" content="http:\/\/media|Request a session|\/book\?/,
				path,
			);
			assert.doesNotMatch(text(page), /Stub (Studio|Artist|Crew|Solo)/, path);
		}
		// Malformed slugs never reach the API.
		assert.ok(!api.requests.some((url) => /Stub-Studio|\/a$|x%20y/.test(url)));
		// The hidden ones are gone from the lists too.
		const directory = await html(await discover.get("/explore/studios"));
		assert.doesNotMatch(directory, /href="\/studios\/stub-studio-2"/);
	});

	test("an old slug is a 301 to the current address; an independent's under /studios to /artists", async () => {
		for (const [path, current] of [
			["/studios/old-stub-studio-1", "/studios/stub-studio-1"],
			[
				"/studios/old-stub-studio-1/artists/crew-1-a",
				"/studios/stub-studio-1/artists/crew-1-a",
			],
			["/artists/old-stub-solo-3", "/artists/stub-solo-3"],
			// An independent's business under /studios (blueprint H).
			["/studios/stub-solo-3", "/artists/stub-solo-3"],
		]) {
			const response = await discover.get(path as string, {
				redirect: "manual",
			});
			assert.equal(response.status, 301, path);
			assert.equal(response.headers.get("location"), current, path);
		}
	});

	test("an API failure is the error state (500, noindex), never a 404", async () => {
		api.scenario.fail.add("studio");
		const response = await discover.get("/studios/stub-studio-1");
		assert.equal(response.status, 500);
		const page = await html(response);
		assert.match(page, /Discover is unavailable for a moment/);
		assert.match(page, />Try again</);
		assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
	});

	test("a failed independent read after a studio 404 is the error state, not a 404", async () => {
		// /studios/stub-solo-3 is no studio (404); the independent read that
		// would 301 it fails transiently: Try again, never a confident 404.
		api.scenario.fail.add("independent");
		const response = await discover.get("/studios/stub-solo-3", {
			redirect: "manual",
		});
		assert.equal(response.status, 500);
		assert.match(await html(response), />Try again</);
	});

	test("an unsafe booking or site link is no link: the page says booking isn't available online", async () => {
		for (const links of [
			{ bookingUrl: `https://evil.test/book?ref=${STUB_REF}` },
			{ bookingUrl: `http://stub-studio-1.example/book?ref=${STUB_REF}` },
			{ bookingUrl: "http://stub-studio-1.localhost:3000/admin" },
			{ bookingUrl: "javascript:alert(1)" },
			{
				bookingUrl: "https://stub-studio-1.example/book",
				storefrontUrl: "http://stub-studio-1.example/",
			},
		]) {
			api.scenario.links = { "stub-studio-1": links };
			const page = await html(await discover.get("/studios/stub-studio-1"));
			assert.equal(linkNamed(page, /^Request a session/), undefined);
			assert.match(
				page,
				/Booking isn(&#x27;|')t available online from Discover right now\./,
			);
			assert.doesNotMatch(page, /data-booking-bar/);
			// The unsafe URL is in the dehydrated API answer, as data, never a link.
			assert.ok(
				!hrefs(page).some((href) =>
					/evil\.test|javascript:|\/admin|stub-studio-1\.example/.test(href),
				),
			);
		}
		// A bad site link: no site link, and no request (its host can't be checked against it).
		api.scenario.links = {
			"stub-studio-1": { storefrontUrl: "javascript:alert(1)" },
		};
		const page = await html(await discover.get("/studios/stub-studio-1"));
		assert.equal(linkNamed(page, /^Visit studio site/), undefined);
		assert.equal(linkNamed(page, /^Request a session/), undefined);
	});

	test("an artist who isn't taking requests says so; the studio's general request remains", async () => {
		const page = await html(
			await discover.get("/studios/stub-studio-9/artists/stub-artist-9"),
		);
		assert.match(
			page,
			/Stub Artist 9 isn(&#x27;|')t taking new requests right now\./,
		);
		assert.equal(linkNamed(page, /^Request with/), undefined);
		assert.equal(
			linkNamed(page, /^Request a session at Stub Studio 9/),
			`http://stub-studio-9.localhost:3000/book?ref=${STUB_REF}`,
		);
	});

	test("no private field reaches the HTML or its dehydrated state", async () => {
		for (const path of [
			"/studios/stub-studio-1",
			"/studios/stub-studio-1/artists/crew-1-a",
			"/artists/stub-solo-3",
		]) {
			const page = await html(await discover.get(path));
			for (const key of PRIVATE_KEYS)
				assert.ok(!page.includes(key), `${path}: ${key}`);
			// The dehydrated profile is the API's public answer.
			assert.match(page, /"discover","(studio|independent-artist)"/);
		}
	});

	test("every studio and artist link in the directories and the homepage opens a profile", async () => {
		const seen = new Set<string>();
		for (const path of [
			"/",
			"/explore/studios",
			"/explore/artists",
			"/explore/artists?country=IN",
		]) {
			const page = await html(await discover.get(path));
			for (const href of hrefs(page))
				if (/^\/(studios|artists)\/[^?]+$/.test(href)) seen.add(href);
		}
		assert.ok(seen.size >= 10, String(seen.size));
		for (const href of seen) {
			const response = await discover.get(href, { redirect: "manual" });
			assert.equal(response.status, 200, href);
			await response.body?.cancel();
		}
	});
});

describe("D08 profiles with indexing on", { skip }, () => {
	let api: StubApi;
	let discover: Discover;
	before(async () => {
		api = await stubApi(20);
		discover = await startDiscover(api.url, {
			DISCOVER_INDEXING: "on",
			DISCOVER_MARKETS: "NP,IN",
		});
	});
	after(() => {
		discover?.child.kill();
		api?.close();
	});

	test("a profile is indexable at its own address; a ?country= variant and a 404 are not", async () => {
		for (const path of [
			"/studios/stub-studio-1",
			"/studios/stub-studio-1/artists/crew-1-a",
			"/artists/stub-solo-3",
		]) {
			const response = await discover.get(path);
			assert.equal(response.status, 200);
			assert.equal(response.headers.get("x-robots-tag"), null, path);
			assert.doesNotMatch(await html(response), /<meta name="robots"/, path);
		}
		// D10: with indexing on, a page that isn't indexable is
		// "noindex, follow" (its links still lead to profiles).
		const variant = await discover.get("/studios/stub-studio-1?country=IN");
		assert.equal(variant.headers.get("x-robots-tag"), "noindex, follow");
		const missing = await discover.get("/studios/nope-studio");
		assert.equal(missing.status, 404);
		assert.equal(missing.headers.get("x-robots-tag"), "noindex, follow");
		assert.match(
			await html(missing),
			/<meta name="robots" content="noindex, follow"\/>/,
		);
		// D10: profiles are in the sitemaps (server-d10.test.ts).
		assert.match(
			await html(await discover.get("/sitemaps/studios.xml")),
			/\/studios\/stub-studio-1</,
		);
	});
});
