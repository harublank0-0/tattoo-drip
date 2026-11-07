import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import {
	assertInternalLinksExist,
	type Discover,
	SITE,
	sentTo,
	skip,
	startDiscover,
	text,
} from "./built-server.ts";
import { STUB_REF, type StubApi, stubApi } from "./stub-api.ts";

/**
 * D09 on the built server (needs `pnpm build`): the tattoo gallery
 * (`/tattoos`), the artwork pages (`/tattoos/:slug`), `/explore/tattoos`'s
 * 301, and the photo links from the homepage, hubs and profiles, against
 * the stub API (markets NP and IN, geolocation from X-Discover-Country).
 * The stub's rules mirror the API's (test/stub-api.ts); the platform's own
 * are in apps/platform tests/functional/api/discover_gallery.spec.ts.
 *
 * Stub facts used here: with 20 rows, photos 3, 7, 11, 15 and 19 are
 * India's (15 are Nepal's); with 40, 30 are Nepal's. Photo n is by artist
 * n (studio n; artists 3, 7, 11… are independent); artist 9 isn't taking
 * requests. Profile photos have ids `…0004<seed><n>`.
 */

const uuid = (kind: number, index: number) =>
	`00000000-0000-4000-8000-${String(kind).padStart(4, "0")}${String(index).padStart(8, "0")}`;
const photo = (n: number) => uuid(3, n);

const html = async (response: Response) => response.text();

/** Every `href` on a page, entities decoded. */
function hrefs(page: string): string[] {
	return [...page.matchAll(/href="([^"]+)"/g)].map((match) =>
		(match[1] as string).replace(/&amp;/g, "&"),
	);
}

/** The artwork pages a page links to. */
const artworkLinks = (page: string) => [
	...new Set(hrefs(page).filter((href) => /^\/tattoos\/[^/?]+$/.test(href))),
];

/** The href of the first link whose text matches `label`. */
function linkNamed(page: string, label: RegExp): string | undefined {
	const match = [
		...page.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g),
	].find((each) => label.test(text(each[2] as string).trim()));
	return match ? (match[1] as string).replace(/&amp;/g, "&") : undefined;
}

/** No link inside another link (one primary link per card). */
function assertNoNestedLinks(page: string) {
	const body = page.replace(/<script[\s\S]*?<\/script>/g, "");
	let depth = 0;
	for (const tag of body.matchAll(/<(\/?)a[\s>]/g)) {
		depth += tag[1] ? -1 : 1;
		assert.ok(depth <= 1, "a link inside a link");
	}
}

/** A page's HTML from one section's heading id to the next section. */
function section(page: string, id: string): string {
	const start = page.indexOf(`id="${id}"`);
	if (start < 0) return "";
	const end = page.indexOf("</section>", start);
	return page.slice(start, end < 0 ? undefined : end);
}

describe("D09 gallery and artwork pages on the built server", { skip }, () => {
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
		api.scenario.status.clear();
		api.scenario.hidden.clear();
		api.scenario.links = {};
	});
	after(() => {
		discover?.child.kill();
		api?.close();
	});

	/* The gallery ------------------------------------------------------- */

	test("the gallery: the visitor's country by default, masonry at true proportions, one link per card", async () => {
		const response = await discover.get("/tattoos");
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("cache-control"), "private, no-store");
		const page = await html(response);
		assert.deepEqual(sentTo(api.requests, "tattoos"), [
			{ country: "NP", limit: "24" },
		]);
		assert.equal(page.match(/<h1[\s>]/g)?.length, 1);
		assert.match(page, /<h1[^>]*>Tattoo inspiration<\/h1>/);
		assert.match(
			page,
			/<title>Tattoo inspiration from Nepal \| Tattoo Drip<\/title>/,
		);
		assert.match(
			page,
			/<link rel="canonical" href="http:\/\/localhost:3100\/tattoos"\/>/,
		);
		// Nepal's 15 photos, each to its artwork page; never India's.
		const links = artworkLinks(page);
		assert.equal(links.length, 15);
		assert.ok(links.includes(`/tattoos/${photo(0)}`));
		assert.ok(!links.includes(`/tattoos/${photo(3)}`));
		// True proportions in fixed frames; the first eager with high
		// priority, the rest of the first row eager, then lazy.
		assert.match(page, /style="aspect-ratio:1200 \/ 1500"/);
		assert.match(page, /style="aspect-ratio:1200 \/ 900"/);
		assert.equal(page.match(/<img [^>]*fetchPriority="high"/g)?.length, 1);
		assert.equal(page.match(/<img [^>]*loading="eager"/g)?.length, 4);
		assert.equal(page.match(/<img [^>]*loading="lazy"/g)?.length, 11);
		assert.match(
			page,
			/columns-2[^"]*sm:columns-3[^"]*lg:columns-4|lg:columns-4/,
		);
		// The caption: the artist (their profile, a separate link), the studio
		// or "Independent", the style.
		assert.match(
			page,
			/href="\/studios\/stub-studio-1\/artists\/stub-artist-1"[^>]*>Stub Artist 1<\/a>/,
		);
		assert.match(text(page), /Stub Artist 1 · Stub Studio 1 · Fine line/);
		assertNoNestedLinks(page);
		assertInternalLinksExist(page);
		// One order only: no sort control. Polite result announcement.
		assert.doesNotMatch(page, /name="sort"/);
		assert.match(page, /<output class="sr-only">15 tattoos shown\.<\/output>/);
		// Indexing off: noindex.
		assert.match(page, /<meta name="robots" content="noindex, nofollow"\/>/);
	});

	test("an explicit ?country= wins; the trusted geolocation header sets the default", async () => {
		const explicit = await html(await discover.get("/tattoos?country=IN"));
		assert.equal(artworkLinks(explicit).length, 5);
		assert.match(explicit, /<title>Tattoo inspiration from India/);
		// India's photos are independent artists': "Independent" in place of a studio.
		assert.match(text(explicit), /Stub Artist 3 · Independent · Traditional/);
		assert.match(
			explicit,
			/<meta name="robots" content="noindex, nofollow"\/>/,
		);
		const geo = await html(
			await discover.get("/tattoos", {
				headers: { "X-Discover-Country": "IN" },
			}),
		);
		assert.equal(artworkLinks(geo).length, 5);
		assert.deepEqual(
			sentTo(api.requests, "tattoos").map((query) => query.country),
			["IN", "IN"],
		);
	});

	test("the search: q forwarded, a plain GET form with the filters as hidden fields, a bad q never sent", async () => {
		const page = await html(
			await discover.get("/tattoos?q=Stub%20Artist%201&style=blackwork"),
		);
		assert.deepEqual(sentTo(api.requests, "tattoos"), [
			{ q: "Stub Artist 1", country: "NP", style: "blackwork", limit: "24" },
		]);
		assert.match(
			page,
			/<search[^>]*><form [^>]*action="\/tattoos" method="get">/,
		);
		assert.match(
			page,
			/<input type="hidden" name="style" value="blackwork"\/>/,
		);
		assert.match(
			page,
			/<input [^>]*type="search"[^>]*name="q" value="Stub Artist 1"/,
		);
		assert.match(page, /<title>Tattoos matching &quot;Stub Artist 1&quot;/);
		// The chip removes only the search.
		assert.ok(hrefs(page).includes("/tattoos?style=blackwork"));
		api.requests.length = 0;
		await discover.get("/tattoos?q=a");
		assert.deepEqual(sentTo(api.requests, "tattoos"), [
			{ country: "NP", limit: "24" },
		]);
		// The search reads photos' words: a studio's name finds its work.
		const studio = await html(
			await discover.get("/tattoos?q=stub%20studio%202"),
		);
		assert.deepEqual(artworkLinks(studio), [`/tattoos/${photo(2)}`]);
	});

	test("filters: style, city with its country, an artist's or a studio's work (global, removable chips)", async () => {
		const place = await html(
			await discover.get("/tattoos?country=NP&city=pokhara&style=blackwork"),
		);
		assert.deepEqual(sentTo(api.requests, "tattoos")[0], {
			country: "NP",
			city: "pokhara",
			style: "blackwork",
			limit: "24",
		});
		assert.match(place, /<title>Blackwork tattoos in Pokhara/);
		// An unknown style and a city without its country are dropped.
		api.requests.length = 0;
		await discover.get("/tattoos?style=nope&city=pokhara");
		assert.deepEqual(sentTo(api.requests, "tattoos"), [
			{ country: "NP", limit: "24" },
		]);
		// One artist's work: no country, the artist's name on its chip.
		api.requests.length = 0;
		const artist = await html(
			await discover.get(`/tattoos?artist=${uuid(2, 1).toUpperCase()}`),
		);
		assert.deepEqual(sentTo(api.requests, "tattoos"), [
			{ artist: uuid(2, 1), limit: "24" },
		]);
		assert.match(artist, /<title>Tattoos by Stub Artist 1/);
		assert.match(text(artist), /By Stub Artist 1 \(remove this filter\)/);
		assert.deepEqual(artworkLinks(artist), [`/tattoos/${photo(1)}`]);
		api.requests.length = 0;
		const studio = await html(
			await discover.get("/tattoos?studio=stub-studio-2"),
		);
		assert.deepEqual(sentTo(api.requests, "tattoos"), [
			{ studio: "stub-studio-2", limit: "24" },
		]);
		assert.match(text(studio), /At Stub Studio 2 \(remove this filter\)/);
		assert.ok(hrefs(studio).includes("/tattoos"));
		// No photo names the studio: a neutral label, never the address's text.
		const unknown = await html(
			await discover.get("/tattoos?studio=totally-fake"),
		);
		assert.match(unknown, /<title>Tattoos from this studio/);
		assert.match(text(unknown), /At this studio \(remove this filter\)/);
		assert.doesNotMatch(unknown, /totally fake/i);
	});

	test("cursor paging: Next page, then First page; a refused cursor goes back to the first page", async () => {
		api.scenario.count = 40;
		const first = await html(await discover.get("/tattoos"));
		assert.equal(artworkLinks(first).length, 24);
		const next = linkNamed(first, /^Next page/);
		assert.ok(next?.startsWith("/tattoos?cursor="), next);
		const second = await html(await discover.get(next as string));
		assert.equal(artworkLinks(second).length, 6);
		assert.ok(
			!artworkLinks(second).some((link) => artworkLinks(first).includes(link)),
		);
		assert.equal(linkNamed(second, /^Next page/), undefined);
		assert.equal(linkNamed(second, /^First page/), "/tattoos");
		// Later pages load every image lazily.
		assert.doesNotMatch(second, /fetchPriority="high"/);
		const refused = await discover.get("/tattoos?q=stub&cursor=bad", {
			redirect: "manual",
		});
		assert.ok([302, 307].includes(refused.status), String(refused.status));
		assert.equal(refused.headers.get("location"), "/tattoos?q=stub");
	});

	test("states: nothing published in the market, no match, an empty later page, an error", async () => {
		api.scenario.count = 0;
		const empty = text(await html(await discover.get("/tattoos")));
		assert.match(empty, /No tattoos are listed in Nepal yet\./);
		assert.match(empty, /Tattoos in India/);
		api.scenario.count = 20;
		const none = await html(
			await discover.get("/tattoos?q=zzzz&style=realism"),
		);
		assert.match(
			text(none),
			/No tattoos match &quot;zzzz&quot;|No tattoos match "zzzz"/,
		);
		assert.equal(linkNamed(none, /^Clear filters$/), "/tattoos");
		assert.ok(
			hrefs(none).includes("/tattoos?style=blackwork"),
			"another style",
		);
		assert.match(text(none), /Tattoos in India/);
		assert.match(none, /<output class="sr-only">No tattoos found\.<\/output>/);
		const late = await html(
			await discover.get(
				`/tattoos?cursor=${Buffer.from(JSON.stringify(["stub", "newest", 400])).toString("base64url")}`,
			),
		);
		assert.match(text(late), /No more tattoos/);
		api.scenario.fail.add("tattoos");
		const failed = await discover.get("/tattoos");
		assert.equal(failed.status, 500);
		const failedPage = text(await html(failed));
		assert.match(failedPage, /Discover is unavailable for a moment/);
		assert.match(failedPage, /Try again/);
	});

	test("a rate-limited search keeps the gallery with a notice; a rate-limited bare gallery is the error page", async () => {
		api.scenario.status.set("tattoos", 429);
		const response = await discover.get(
			"/tattoos?q=koi%20fish&style=blackwork",
		);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("cache-control"), "private, no-store");
		const page = await html(response);
		const words = text(page);
		assert.match(
			words,
			/Searching is busy right now\. Try again in a moment\./,
		);
		assert.match(page, /<title>Tattoos matching &quot;koi fish&quot;/);
		// The search box still holds the query, and its chip is there.
		assert.match(page, /<input[^>]*name="q"[^>]*value="koi fish"/);
		assert.match(words, /“koi fish” \(remove this filter\)/);
		// Try again is the same address; no results, no paging.
		const retry = new URL(linkNamed(page, /^Try again$/) ?? "", SITE);
		assert.equal(retry.pathname, "/tattoos");
		assert.deepEqual(Object.fromEntries(retry.searchParams), {
			q: "koi fish",
			style: "blackwork",
		});
		assert.deepEqual(artworkLinks(page), []);
		assert.equal(linkNamed(page, /^Next page/), undefined);
		assert.doesNotMatch(words, /No tattoos match/);
		assert.doesNotMatch(words, /Discover is unavailable for a moment/);
		// Without a search, the same 429 is the route's error state.
		const bare = await discover.get("/tattoos?style=blackwork");
		assert.equal(bare.status, 500);
		assert.match(
			text(await html(bare)),
			/Discover is unavailable for a moment/,
		);
		// Answered again: the same search shows its results.
		api.scenario.status.clear();
		const again = await html(await discover.get("/tattoos?q=stub"));
		assert.doesNotMatch(text(again), /Searching is busy/);
		assert.ok(artworkLinks(again).length > 0);
	});

	test("/explore/tattoos is a 301 to /tattoos, its query kept", async () => {
		const bare = await discover.get("/explore/tattoos", { redirect: "manual" });
		assert.equal(bare.status, 301);
		assert.equal(bare.headers.get("location"), "/tattoos");
		const query = await discover.get(
			"/explore/tattoos?style=blackwork&q=koi%20fish&country=IN",
			{ redirect: "manual" },
		);
		assert.equal(query.status, 301);
		const location = new URL(query.headers.get("location") ?? "", SITE);
		assert.equal(location.pathname, "/tattoos");
		assert.deepEqual(Object.fromEntries(location.searchParams), {
			style: "blackwork",
			q: "koi fish",
			country: "IN",
		});
		assert.deepEqual(api.requests, []);
	});

	/* Artwork pages ----------------------------------------------------- */

	test("an artwork: artwork first, attribution from the data, booking, share, related, head tags", async () => {
		const response = await discover.get(`/tattoos/${photo(0)}`);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("cache-control"), "private, no-store");
		const page = await html(response);
		assert.equal(page.match(/<h1[\s>]/g)?.length, 1);
		assert.match(page, /<h1[^>]*>Blackwork tattoo by Stub Artist 0<\/h1>/);
		// The image loads first, sized, with its alt text from the data.
		assert.match(
			page,
			/<img src="http:\/\/media\.test\/tattoo-0\.jpg"[^>]*width="1200" height="1500" alt="Blackwork tattoo by Stub Artist 0 at Stub Ink &lt;b&gt;Studio&lt;\/b&gt;" loading="eager"[^>]*fetchPriority="high"/,
		);
		assert.equal(page.match(/<img [^>]*fetchPriority="high"/g)?.length, 1);
		assert.equal(
			linkNamed(page, /^View full size/),
			"http://media.test/tattoo-0.jpg",
		);
		// Attribution: the artist's and studio's profiles, the style page, the city page.
		const facts = text(page);
		assert.match(facts, /Artist Stub Artist 0/);
		assert.ok(
			hrefs(page).includes("/studios/stub-studio-0/artists/stub-artist-0"),
		);
		assert.ok(hrefs(page).includes("/studios/stub-studio-0"));
		assert.ok(hrefs(page).includes("/styles/blackwork"));
		assert.ok(hrefs(page).includes("/locations/nepal/pokhara"));
		// Booking: the storefront's "Request a similar tattoo", with the photo and the referral.
		assert.equal(
			linkNamed(page, /^Request a similar tattoo/),
			`http://stub-studio-0.localhost:3000/book?artwork=${photo(0)}&ref=${STUB_REF}`,
		);
		assert.equal(
			linkNamed(page, /^View on studio site/),
			`http://stub-studio-0.localhost:3000/gallery/${photo(0)}`,
		);
		assert.match(facts, /It(&#x27;|')s a request, not an instant booking/);
		// Share: Copy link (the server can't know about a share sheet), a live region.
		assert.match(page, /<button[^>]*>[\s\S]*?Copy link<\/button>/);
		assert.match(page, /<output aria-live="polite"/);
		assert.equal(linkNamed(page, /^Back to the gallery/), "/tattoos");
		// Head: canonical slug URL, the artwork as the social card.
		assert.match(
			page,
			new RegExp(
				`<link rel="canonical" href="${SITE.replace(/[/.]/g, "\\$&")}/tattoos/${photo(0)}"/>`,
			),
		);
		assert.match(
			page,
			/<meta property="og:image" content="http:\/\/media\.test\/tattoo-0\.jpg"\/>/,
		);
		assert.match(
			page,
			/<meta name="twitter:card" content="summary_large_image"\/>/,
		);
		assert.match(
			page,
			/<title>Blackwork tattoo by Stub Artist 0 at Stub Ink &lt;b&gt;Studio&lt;\/b&gt;, Pokhara \| Tattoo Drip<\/title>/,
		);
		assertNoNestedLinks(page);
		assertInternalLinksExist(page);
		// One detail read, then the related reads composed from the list's filters.
		assert.deepEqual(
			api.requests.map((url) => url.replace("/api/v1/discover", "")),
			[
				`/tattoos/${photo(0)}`,
				`/tattoos?artist=${uuid(2, 0)}&limit=9`,
				"/tattoos?style=blackwork&country=NP&limit=9",
			],
		);
		// More blackwork in Nepal: 6, 12, 18; never the current photo.
		const style = section(page, "artwork-style-title");
		assert.deepEqual(
			artworkLinks(style),
			[6, 12, 18].map((n) => `/tattoos/${photo(n)}`),
		);
		// The artist's only listed photo is this one: no "More by" section.
		assert.equal(section(page, "artwork-artist-title"), "");
	});

	test("related work: the artist's first, then the style's in the page's country, de-duplicated", async () => {
		// Stub Artist 1's first profile photo (fine line): their listed photo
		// is #1, and Nepal's fine line photos are #1 and #13.
		const current = uuid(4, 1000);
		const page = await html(await discover.get(`/tattoos/${current}`));
		const artist = section(page, "artwork-artist-title");
		assert.match(artist, /More by Stub Artist 1/);
		assert.deepEqual(artworkLinks(artist), [`/tattoos/${photo(1)}`]);
		assert.equal(
			linkNamed(artist, /^All work by Stub Artist 1/),
			`/tattoos?artist=${uuid(2, 1)}`,
		);
		const style = section(page, "artwork-style-title");
		assert.match(style, /More Fine line work/);
		assert.deepEqual(artworkLinks(style), [`/tattoos/${photo(13)}`]);
		assert.ok(!artworkLinks(page).includes(`/tattoos/${current}`));
		assert.equal(
			linkNamed(style, /^All Fine line tattoos/),
			"/tattoos?style=fine-line",
		);
		// With ?country=IN the style section follows it (India's fine line:
		// #7 and #19), and the page is a noindex variant.
		api.requests.length = 0;
		const india = await html(
			await discover.get(`/tattoos/${current}?country=IN`),
		);
		assert.deepEqual(sentTo(api.requests, "tattoos").at(-1), {
			style: "fine-line",
			country: "IN",
			limit: "9",
		});
		assert.deepEqual(
			artworkLinks(section(india, "artwork-style-title")),
			[7, 19].map((n) => `/tattoos/${photo(n)}`),
		);
		assert.match(india, /Recently published in India\./);
		assert.match(india, /<meta name="robots" content="noindex, nofollow"\/>/);
	});

	test("a failed related read hides only its section", async () => {
		api.scenario.fail.add("tattoos");
		const response = await discover.get(`/tattoos/${uuid(4, 1000)}`);
		assert.equal(response.status, 200);
		const page = await html(response);
		assert.equal(section(page, "artwork-artist-title"), "");
		assert.equal(section(page, "artwork-style-title"), "");
		assert.match(page, /Request a similar tattoo/);
	});

	test("an artist who isn't taking requests: said so; a studio's piece keeps the studio's request", async () => {
		const page = await html(await discover.get(`/tattoos/${photo(9)}`));
		assert.match(
			text(page),
			/Stub Artist 9 isn(&#x27;|')t taking new requests right now\./,
		);
		assert.equal(
			linkNamed(page, /^Request a similar tattoo at Stub Studio 9/),
			`http://stub-studio-9.localhost:3000/book?artwork=${photo(9)}&ref=${STUB_REF}`,
		);
	});

	test("an independent artist's piece: their business, no studio link", async () => {
		const page = await html(await discover.get(`/tattoos/${photo(3)}`));
		assert.match(text(page), /Studio Independent artist/);
		assert.ok(hrefs(page).includes("/artists/stub-solo-3"));
		assert.ok(
			!hrefs(page).some((href) => href.startsWith("/studios/stub-solo")),
		);
		assert.equal(
			linkNamed(page, /^View on their site/),
			`http://stub-solo-3.localhost:3000/gallery/${photo(3)}`,
		);
	});

	test("an unsafe booking link from the API is no link at all", async () => {
		api.scenario.links[photo(0)] = {
			bookingUrl: `https://evil.example/book?artwork=${photo(0)}&ref=${STUB_REF}`,
		};
		const page = await html(await discover.get(`/tattoos/${photo(0)}`));
		assert.equal(linkNamed(page, /^Request a similar tattoo/), undefined);
		assert.match(
			text(page),
			/Booking isn(&#x27;|')t available online from Discover right now\./,
		);
		assert.ok(!hrefs(page).some((href) => href.includes("evil.example")));
	});

	test("unknown, hidden or taken down, a hidden artist or studio, a malformed slug: the same 404, noindex", async () => {
		api.scenario.hidden.add(photo(2));
		api.scenario.hidden.add("stub-studio-5");
		api.scenario.hidden.add("stub-studio-6/maya");
		for (const path of [
			`/tattoos/${uuid(3, 999)}`,
			`/tattoos/${photo(2)}`,
			`/tattoos/${photo(5)}`,
			`/tattoos/${photo(6)}`,
			"/tattoos/nope",
			"/tattoos/koi-sleeve",
		]) {
			const response = await discover.get(path);
			assert.equal(response.status, 404, path);
			const page = await html(response);
			assert.match(
				page,
				/<meta name="robots" content="noindex, nofollow"\/>/,
				path,
			);
			assert.match(page, /Nothing here/, path);
			assert.doesNotMatch(page, /og:image/, path);
			assert.doesNotMatch(text(page), /Stub Artist/, path);
		}
		// A malformed slug never reaches the API.
		api.requests.length = 0;
		await discover.get("/tattoos/nope");
		assert.deepEqual(api.requests, []);
		// The hidden photo also leaves the gallery.
		const gallery = await html(await discover.get("/tattoos"));
		assert.ok(!artworkLinks(gallery).includes(`/tattoos/${photo(2)}`));
	});

	test("a readable prefix resolves by the id and 301s to the canonical slug", async () => {
		const response = await discover.get(`/tattoos/koi-sleeve-${photo(0)}`, {
			redirect: "manual",
		});
		assert.equal(response.status, 301);
		assert.equal(response.headers.get("location"), `/tattoos/${photo(0)}`);
		const gone = await discover.get(`/tattoos/koi-${uuid(3, 999)}`, {
			redirect: "manual",
		});
		assert.equal(gone.status, 404);
	});

	/* Links into the artwork pages ------------------------------------- */

	test("home, hubs and profiles link photos to their artwork pages, and every one answers", async () => {
		const pages = {
			home: await html(await discover.get("/")),
			style: await html(await discover.get("/styles/blackwork")),
			city: await html(await discover.get("/locations/nepal/pokhara")),
			studio: await html(await discover.get("/studios/stub-studio-1")),
			artist: await html(
				await discover.get("/studios/stub-studio-1/artists/stub-artist-1"),
			),
		};
		const seen = new Set<string>();
		for (const [name, page] of Object.entries(pages)) {
			const links = artworkLinks(page);
			assert.ok(links.length > 0, name);
			for (const link of links) seen.add(link);
			assertNoNestedLinks(page);
			assertInternalLinksExist(page);
		}
		// "See all work" and hub links go to the gallery with the API's filters.
		assert.equal(
			linkNamed(pages.studio, /^All work at Stub Studio 1/),
			"/tattoos?studio=stub-studio-1",
		);
		assert.equal(
			linkNamed(pages.artist, /^All work by Stub Artist 1/),
			`/tattoos?artist=${uuid(2, 1)}`,
		);
		assert.equal(
			linkNamed(pages.style, /^All Blackwork tattoos/),
			"/tattoos?style=blackwork",
		);
		assert.equal(
			linkNamed(pages.city, /^All work from Pokhara/),
			"/tattoos?country=NP&city=pokhara",
		);
		assert.equal(linkNamed(pages.home, /^Explore artwork/), "/tattoos");
		// The studio's portfolio still credits (and links) each artist, beside the image.
		assert.match(
			pages.studio,
			/href="\/studios\/stub-studio-1\/artists\/crew-1-a"[^>]*>Stub Crew 1A<\/a>/,
		);
		// No dead links: every artwork page linked answers 200.
		for (const link of seen) {
			const response = await discover.get(link);
			assert.equal(response.status, 200, link);
			await response.body?.cancel();
		}
	});
});

describe("D09 indexing on", { skip }, () => {
	let api: StubApi;
	let discover: Discover;
	before(async () => {
		api = await stubApi(20);
		discover = await startDiscover(api.url, { DISCOVER_INDEXING: "on" });
	});
	after(() => {
		discover?.child.kill();
		api?.close();
	});

	test("the bare gallery and canonical artwork pages may be indexed; any parameter, a 404 or a 301 never", async () => {
		for (const path of ["/tattoos", `/tattoos/${photo(0)}`]) {
			const response = await discover.get(path);
			assert.equal(response.status, 200, path);
			assert.equal(response.headers.get("x-robots-tag"), null, path);
			assert.doesNotMatch(await response.text(), /<meta name="robots"/, path);
		}
		for (const path of [
			"/tattoos?q=stub",
			"/tattoos?style=blackwork",
			"/tattoos?artist=00000000-0000-4000-8000-000200000001",
			"/tattoos?country=NP",
			`/tattoos/${photo(0)}?country=NP`,
			`/tattoos/${uuid(3, 999)}`,
		]) {
			const page = await (await discover.get(path)).text();
			assert.match(
				page,
				/<meta name="robots" content="noindex, nofollow"\/>/,
				path,
			);
		}
		// A rate-limited search (the busy notice) is never indexed either.
		api.scenario.status.set("tattoos", 429);
		const busy = await discover.get("/tattoos?q=stub");
		assert.equal(busy.status, 200);
		const busyPage = await busy.text();
		assert.match(busyPage, /Searching is busy/);
		assert.match(
			busyPage,
			/<meta name="robots" content="noindex, nofollow"\/>/,
		);
		api.scenario.status.clear();
		const sitemap = await (await discover.get("/sitemap.xml")).text();
		assert.match(sitemap, /<loc>http:\/\/localhost:3100\/tattoos<\/loc>/);
	});
});
