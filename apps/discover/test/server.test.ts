import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import {
	assertInternalLinksExist,
	freePort,
	SITE,
	sentTo,
	skip,
	startDiscover,
	text,
} from "./built-server.ts";
import { type Endpoint, type StubApi, stubApi } from "./stub-api.ts";

/**
 * The built server, started as production starts it (D05, D06), against a
 * stub of the Discover API serving 0, 3 or 20 studios, artists and photos:
 * the shell, the head and indexing rules, the homepage's sections and
 * their thresholds, failing and hanging reads, the studio filters, the
 * marketing pages. Needs `pnpm build` first (CI builds before testing);
 * skipped without a build.
 */
const HOME_READS: Endpoint[] = [
	"tattoos",
	"studios",
	"artists",
	"styles",
	"locations",
];
const SECTIONS = [
	"styles-title",
	"studios-title",
	"artists-title",
	"inspiration-title",
	"locations-title",
];
const STATIC_BANDS = ["booking-title", "studio-os-title", "final-title"];

/** The sections a homepage rendered, by their headings' ids. */
function sections(html: string): string[] {
	return SECTIONS.filter((id) => html.includes(`id="${id}"`));
}

function assertHeroAndSearch(html: string) {
	assert.match(
		html,
		/<h1 id="home-title"[^>]*>Find your next tattoo artist\.<\/h1>/,
	);
	assert.match(
		html,
		/<search[^>]*><form[^>]*action="\/explore\/studios" method="get"/,
	);
	assert.match(html, /<input[^>]*type="search"[^>]*name="q"/);
	assert.equal(html.match(/<h1[\s>]/g)?.length, 1);
	for (const id of STATIC_BANDS) assert.match(html, new RegExp(`id="${id}"`));
}

describe("the built Discover server, indexing off", { skip }, () => {
	let api: StubApi;
	let discover: Awaited<ReturnType<typeof startDiscover>>;
	before(async () => {
		api = await stubApi();
		discover = await startDiscover(api.url);
	});
	beforeEach(() => {
		api.requests.length = 0;
		api.scenario.count = 1;
		api.scenario.fail.clear();
		api.scenario.hang.clear();
	});
	after(() => {
		discover?.child.kill();
		api?.close();
	});

	test("the shell renders server-side with safe defaults, and reads no API data itself", async () => {
		const response = await discover.get("/for-studios");
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
		const html = await response.text();
		assert.match(html, /<html lang="en">/);
		assert.match(html, /<meta name="robots" content="noindex, nofollow"\/>/);
		assert.match(html, /<a class="skip-link" href="#main">/);
		assert.match(html, /<main id="main"/);
		assert.match(html, /<footer class="night">/);
		assert.match(html, /<nav aria-label="Discover"/);
		for (const path of [
			"/",
			"/explore/studios",
			"/explore/artists",
			"/tattoos",
			"/for-studios",
			"/pricing",
		]) {
			assert.match(html, new RegExp(`href="${path}"`), path);
		}
		assert.match(html, /href="http:\/\/app\.localhost:3333\/login"/);
		assert.match(html, /href="http:\/\/app\.localhost:3333\/signup"/);
		assert.match(html, /aria-current="page"[^>]*>For studios</);
		assert.doesNotMatch(html, /API_URL|process\.env/);
		assert.deepEqual(api.requests, []);
	});

	test("home with nothing listed: the hero, search and static bands only, never a 0", async () => {
		api.scenario.count = 0;
		const response = await discover.get("/");
		assert.equal(response.status, 200);
		const html = await response.text();
		assertHeroAndSearch(html);
		assert.deepEqual(sections(html), []);
		// Typographic hero: no collage, the explore links instead.
		assert.doesNotMatch(html, /fetchPriority="high"/);
		assert.match(html, /<nav aria-label="Explore"/);
		assert.doesNotMatch(html, /role="alert"/);
		assert.doesNotMatch(text(html), /\b0\b/);
		assert.doesNotMatch(html, /Stub /);
	});

	test("home with 3 of each: studios, artists, styles and places; no collage or inspiration grid", async () => {
		api.scenario.count = 3;
		const html = await (await discover.get("/")).text();
		assertHeroAndSearch(html);
		assert.deepEqual(sections(html), [
			"styles-title",
			"studios-title",
			"artists-title",
			"locations-title",
		]);
		assert.doesNotMatch(html, /fetchPriority="high"/);
		// Names come from the API, as text.
		assert.match(html, /Stub Ink &lt;b&gt;Studio&lt;\/b&gt;/);
		assert.match(html, /Stub Studio 2/);
		assert.match(html, /Stub Artist 1/);
		// D08: studios and artists link to their Discover profiles.
		assert.match(html, /href="\/studios\/stub-studio-1"/);
		assert.match(
			html,
			/href="\/studios\/stub-studio-0\/artists\/stub-artist-0"/,
		);
		assert.doesNotMatch(html, /href="http:\/\/stub-studio/);
		assert.match(html, />Recently listed studios</);
		assert.doesNotMatch(text(html), /\bfeatured\b|\btop-rated\b|\bpopular\b/i);
	});

	test("home with 20: every section, the collage, real links and alt text; each read once", async () => {
		api.scenario.count = 20;
		const html = await (await discover.get("/")).text();
		assertHeroAndSearch(html);
		assert.deepEqual(sections(html), SECTIONS);
		// The collage's first photo loads at once, sized and preloaded; the rest lazily.
		assert.equal(html.match(/<img [^>]*fetchPriority="high"/g)?.length, 1);
		assert.match(
			html,
			/<link rel="preload" as="image"[^>]*fetchPriority="high"/,
		);
		assert.match(
			html,
			/<img src="http:\/\/media\.test\/tattoo-0\.jpg"[^>]*width="1200" height="1500" alt="Blackwork tattoo by Stub Artist 0 at Stub Ink &lt;b&gt;Studio&lt;\/b&gt;" loading="eager"/,
		);
		assert.match(html, /loading="lazy"/);
		assert.doesNotMatch(html, /alt=""[^>]*src="http:\/\/media\.test/);
		// D07: styles link to their pages, places to their city pages, the
		// country's name to its location page.
		assert.match(html, /href="\/styles\/blackwork"/);
		assert.match(html, /href="\/styles\/fine-line"/);
		assert.match(html, /href="\/locations\/nepal\/pokhara"/);
		assert.match(html, /href="\/locations\/nepal"/);
		assert.doesNotMatch(html, /\?style=|city=/);
		// Only the page's country's places (the API's list has every country).
		assert.doesNotMatch(html, /href="[^"]*new-delhi/);
		assert.match(html, />Nepal</);
		assert.match(html, /href="\/tattoos"/);
		// D09: photos open their artwork pages; their artists' names link
		// their profiles (D08), beside the image, never around it.
		assert.match(
			html,
			/href="\/tattoos\/00000000-0000-4000-8000-000300000000"/,
		);
		assert.match(
			html,
			/href="\/studios\/stub-studio-0\/artists\/stub-artist-0"/,
		);
		assertInternalLinksExist(html);
		// One request per read, with the homepage's limits; none repeated.
		// Studios, artists and photos are the default country's (NP).
		assert.deepEqual([...api.requests].sort(), [
			"/api/v1/discover/artists?limit=8&country=NP",
			"/api/v1/discover/locations",
			"/api/v1/discover/studios?limit=8&country=NP",
			"/api/v1/discover/styles",
			"/api/v1/discover/tattoos?limit=24&country=NP",
		]);
		// The answers are dehydrated, so the browser reuses them.
		assert.match(html, /"discover","tattoos"/);
		assert.doesNotMatch(text(html), /\b20\b/);
	});

	test("one failing read hides only its section; the page is still a 200", async () => {
		api.scenario.count = 20;
		api.scenario.fail.add("studios");
		const response = await discover.get("/");
		assert.equal(response.status, 200);
		const html = await response.text();
		assert.deepEqual(
			sections(html),
			SECTIONS.filter((id) => id !== "studios-title"),
		);
		assert.doesNotMatch(html, /role="alert"/);
	});

	test("every read failing: a 200 with one quiet note and a retry, and the static bands", async () => {
		for (const endpoint of HOME_READS) api.scenario.fail.add(endpoint);
		const response = await discover.get("/");
		assert.equal(response.status, 200);
		const html = await response.text();
		assertHeroAndSearch(html);
		assert.deepEqual(sections(html), []);
		assert.equal(html.match(/role="alert"/g)?.length, 1);
		assert.match(html, /couldn&#x27;t load just now|couldn't load just now/);
		assert.match(html, />Try again</);
	});

	test("a hung read is cut off by the server's timeout; the page still renders", async () => {
		api.scenario.count = 20;
		api.scenario.hang.add("tattoos");
		const started = Date.now();
		const response = await discover.get("/");
		assert.equal(response.status, 200);
		const html = await response.text();
		const took = Date.now() - started;
		// SERVER_TIMEOUT_MS (5 s) bounds every server read.
		assert.ok(took < 8_000, `took ${took} ms`);
		assert.deepEqual(sections(html), [
			"studios-title",
			"artists-title",
			"locations-title",
		]);
	});

	test("/explore/studios reads the API on the server and hands the browser its cache", async () => {
		const response = await discover.get("/explore/studios?q=stub");
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
		const html = await response.text();
		// The default country applies when the address names none.
		assert.deepEqual(sentTo(api.requests, "studios"), [
			{ q: "stub", country: "NP", limit: "24" },
		]);
		// API text is text, never markup.
		assert.match(html, /Stub Ink &lt;b&gt;Studio&lt;\/b&gt;/);
		assert.match(html, /href="\/studios\/stub-studio-0"/);
		assert.match(html, /Pokhara, Gandaki/);
		assert.match(html, />Blackwork</);
		assert.match(html, /"discover","studios"/);
		assert.match(
			html,
			/<title>Studios matching &quot;stub&quot; \| Tattoo Drip<\/title>/,
		);
	});

	test("/explore/studios forwards q, country, city and style, and shows them as removable chips", async () => {
		const response = await discover.get(
			"/explore/studios?q=stub%20ink&country=np&city=pokhara&style=blackwork",
		);
		assert.equal(response.status, 200);
		const html = await response.text();
		const studios = api.requests.filter((url) =>
			url.startsWith("/api/v1/discover/studios"),
		);
		assert.equal(studios.length, 1);
		const sent = new URL(studios[0] ?? "", "http://stub").searchParams;
		assert.deepEqual(Object.fromEntries(sent), {
			country: "NP",
			city: "pokhara",
			style: "blackwork",
			q: "stub ink",
			limit: "24",
		});
		assert.match(studios[0] ?? "", /q=stub(\+|%20)ink/);
		// Chips: names from the API's lists; each removes its own filter.
		assert.match(html, />Pokhara<!-- --> ?<svg|>Pokhara<svg|Pokhara<svg/);
		assert.match(html, /Nepal/);
		assert.match(html, /Blackwork<svg|Blackwork<!-- -->/);
		assert.match(html, /\(remove this filter\)/);
		assert.match(
			html,
			/href="\/explore\/studios\?q=stub(%20|\+)ink&amp;country=NP&amp;style=blackwork"/,
		);
	});

	test("malformed or unknown filters never reach the API", async () => {
		for (const search of [
			"country=NPL&city=pokhara",
			"city=pokhara",
			"country=NP&city=Not_A_Slug",
			"style=Glitter!",
			"style=glitter",
			"q=a",
		]) {
			api.requests.length = 0;
			const response = await discover.get(`/explore/studios?${search}`);
			assert.equal(response.status, 200, search);
			const studios = api.requests.filter((url) =>
				url.startsWith("/api/v1/discover/studios"),
			);
			const sent = new URL(studios[0] ?? "", "http://stub").searchParams;
			assert.ok(!sent.has("city"), search);
			assert.ok(!sent.has("style"), search);
			assert.ok(!sent.has("q"), search);
			// A malformed country is ignored: the visitor's (the default) applies.
			assert.equal(sent.get("country"), "NP", search);
		}
	});

	test("a style that can't be checked is dropped, not sent: the page still lists studios", async () => {
		api.scenario.fail.add("styles");
		const response = await discover.get("/explore/studios?style=blackwork");
		assert.equal(response.status, 200);
		const studios = api.requests.filter((url) =>
			url.startsWith("/api/v1/discover/studios"),
		);
		assert.equal(studios.length, 1);
		assert.ok(
			!new URL(studios[0] ?? "", "http://stub").searchParams.has("style"),
		);
		assert.match(await response.text(), /Stub Ink/);
	});

	test("/explore/artists lists the API's artists, linking to their pages", async () => {
		api.scenario.count = 3;
		const response = await discover.get("/explore/artists");
		assert.equal(response.status, 200);
		const html = await response.text();
		assert.deepEqual(sentTo(api.requests, "artists"), [
			{ country: "NP", limit: "24" },
		]);
		assert.match(html, /Stub Artist 2/);
		assert.match(
			html,
			/href="\/studios\/stub-studio-2\/artists\/stub-artist-2"/,
		);
		assert.match(html, /<meta name="robots" content="noindex, nofollow"\/>/);
	});

	test("/for-studios and /pricing: finished pages, Studio OS links on APP_URL, no prices or checkout", async () => {
		for (const path of ["/for-studios", "/pricing"]) {
			const response = await discover.get(path);
			assert.equal(response.status, 200, path);
			const html = await response.text();
			assert.match(
				html,
				/href="http:\/\/app\.localhost:3333\/signup"[^>]*>Get started</,
			);
			assert.doesNotMatch(
				html,
				/role="note"[^>]*>\s*<p class="eyebrow[^"]*">Coming soon/,
			);
			assert.doesNotMatch(html, /href="\/(login|signup)"/);
			const words = text(html);
			assert.doesNotMatch(words, /checkout/i, path);
			assert.doesNotMatch(words, /\$/, path);
			assert.doesNotMatch(words, /\btrial\b/i, path);
			assert.doesNotMatch(
				words,
				/\b(NPR|Rs\.?|USD|EUR)\s?\d|\d+\s?(\/|per )\s?month/i,
				path,
			);
			assert.equal(html.match(/<h1[\s>]/g)?.length, 1, path);
		}
		const studios = await (await discover.get("/for-studios")).text();
		assert.match(studios, /Your studio\. Beautifully managed\./);
		assert.match(studios, /href="#features"/);
		assert.match(studios, /id="features"/);
		assert.match(
			studios,
			/href="http:\/\/app\.localhost:3333\/login"[^>]*>Sign in</,
		);
		assert.match(studios, /Stencil &amp; Ink/);
		assert.match(studios, /Ink Noir/);
		assert.match(studios, /Irezumi/);
		assert.match(studios, /Atelier/);
		assert.match(studios, /Custom domains are planned/);
		assert.match(studios, /Discover is being prepared for launch/);
		const pricing = await (await discover.get("/pricing")).text();
		assert.match(pricing, /Simple plans for tattoo professionals\./);
		assert.match(pricing, /Nothing on this site takes payment/);
		assert.deepEqual(api.requests, []);
	});

	test("each page's own title, description and canonical on DISCOVER_URL", async () => {
		const pages: [string, RegExp, RegExp][] = [
			[
				"/",
				/<title>Tattoo Drip: find tattoo studios, artists and work<\/title>/,
				/<meta name="description" content="Find a tattoo artist or studio/,
			],
			[
				"/for-studios",
				/<title>Studio OS: tattoo studio management software \| Tattoo Drip<\/title>/,
				/<meta name="description" content="Studio OS runs a tattoo studio&#x27;s requests|<meta name="description" content="Studio OS runs a tattoo studio's requests/,
			],
			[
				"/pricing",
				/<title>Pricing \| Tattoo Drip<\/title>/,
				/<meta name="description" content="Studio OS pricing for tattoo studios/,
			],
		];
		for (const [path, title, description] of pages) {
			const html = await (await discover.get(path)).text();
			assert.match(html, title, path);
			assert.match(html, description, path);
			assert.equal(html.match(/<meta name="description"/g)?.length, 1, path);
			assert.match(
				html,
				new RegExp(`<link rel="canonical" href="${SITE}${path}"/>`),
				path,
			);
			assert.equal(html.match(/<link rel="canonical"/g)?.length, 1, path);
		}
	});

	test("indexing off: every page says noindex; robots.txt disallows everything; no sitemap", async () => {
		for (const path of [
			"/",
			"/for-studios",
			"/pricing",
			"/explore/studios",
			"/explore/artists",
			"/tattoos",
		]) {
			const response = await discover.get(path);
			assert.equal(
				response.headers.get("x-robots-tag"),
				"noindex, nofollow",
				path,
			);
			const html = await response.text();
			assert.equal(
				html.match(/<meta name="robots" content="noindex, nofollow"\/>/g)
					?.length,
				1,
				path,
			);
		}
		assert.equal(
			await (await discover.get("/robots.txt")).text(),
			"User-agent: *\nDisallow: /\n",
		);
		assert.equal((await discover.get("/sitemap.xml")).status, 404);
	});

	test("an unknown page is a titled 404", async () => {
		const missing = await discover.get("/no-such-page");
		assert.equal(missing.status, 404);
		assert.equal(missing.headers.get("x-robots-tag"), "noindex, nofollow");
		const page = await missing.text();
		assert.match(page, /Nothing here/);
		assert.match(page, /<title>Page not found \| Tattoo Drip<\/title>/);
	});
});

describe("the built Discover server, API unreachable", { skip }, () => {
	let discover: Awaited<ReturnType<typeof startDiscover>>;
	before(async () => {
		discover = await startDiscover(`http://localhost:${await freePort()}`);
	});
	after(() => discover?.child.kill());

	test("the homepage still renders with its note; a data page says Discover is unavailable", async () => {
		const home = await discover.get("/");
		assert.equal(home.status, 200);
		const homeHtml = await home.text();
		assert.match(homeHtml, /role="alert"/);
		assert.match(homeHtml, /id="studio-os-title"/);
		const response = await discover.get("/explore/studios");
		assert.equal(response.status, 500);
		assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
		const html = await response.text();
		assert.match(html, /Discover is unavailable for a moment/);
		assert.match(html, /Try again/);
		// The marked message travels with the page, so the browser shows the same state.
		assert.match(
			html,
			/Discover&#x27;s data is unavailable right now\.|Discover's data is unavailable right now\./,
		);
	});
});

describe("the built Discover server, indexing on", { skip }, () => {
	let api: StubApi;
	let discover: Awaited<ReturnType<typeof startDiscover>>;
	before(async () => {
		api = await stubApi(3);
		discover = await startDiscover(api.url, { DISCOVER_INDEXING: "on" });
	});
	after(() => {
		discover?.child.kill();
		api?.close();
	});

	test("only listed pages may be indexed (D07: bare directories, styles, places); the rest still say noindex", async () => {
		for (const path of [
			"/",
			"/for-studios",
			"/explore/studios",
			"/explore/artists",
			"/styles/blackwork",
			"/locations/nepal",
			"/locations/nepal/pokhara",
		]) {
			const page = await discover.get(path);
			assert.equal(page.headers.get("x-robots-tag"), null, path);
			assert.doesNotMatch(await page.text(), /<meta name="robots"/, path);
		}
		for (const path of [
			"/pricing",
			"/tattoos?q=stub",
			// Any parameter: filters, search, sort, cursor, country.
			"/explore/studios?style=blackwork",
			"/explore/studios?q=stub",
			"/explore/studios?sort=name",
			"/explore/artists?independent=true",
			"/explore/artists?country=NP&city=pokhara",
			"/styles/blackwork?country=NP",
			// Nothing listed under it in Nepal (3 rows: blackwork, fine line, realism).
			"/styles/geometric",
			"/styles/glitter",
			"/locations/atlantis",
		]) {
			// D10: not indexable while indexing is on: noindex, follow (meta and header).
			const response = await discover.get(path);
			assert.equal(
				response.headers.get("x-robots-tag"),
				"noindex, follow",
				path,
			);
			const page = await response.text();
			assert.equal(
				page.match(/<meta name="robots" content="noindex, follow"\/>/g)?.length,
				1,
				path,
			);
		}
		assert.match(
			await (await discover.get("/robots.txt")).text(),
			/Sitemap: http:\/\/localhost:3100\/sitemap\.xml/,
		);
		// D10: the sitemap index; its static child lists the static indexable pages.
		const index = await discover.get("/sitemap.xml");
		assert.equal(index.status, 200);
		assert.match(await index.text(), /<sitemapindex /);
		const locs = [
			...(await (await discover.get("/sitemaps/static.xml")).text()).matchAll(
				/<loc>([^<]+)<\/loc>/g,
			),
		].map((match) => match[1]);
		assert.deepEqual(locs, [
			`${SITE}/`,
			`${SITE}/for-studios`,
			`${SITE}/explore/studios`,
			`${SITE}/explore/artists`,
			`${SITE}/tattoos`,
		]);
	});
});

/** The country part of each home read the API got (studios, artists, photos). */
function homeCountries(requests: string[]): Record<string, string | null> {
	const sent: Record<string, string | null> = {};
	for (const url of requests) {
		const address = new URL(url, "http://stub");
		const endpoint = address.pathname.replace("/api/v1/discover/", "");
		if (["studios", "artists", "tattoos"].includes(endpoint))
			sent[endpoint] = address.searchParams.get("country");
	}
	return sent;
}

const NP_EVERYWHERE = { studios: "NP", artists: "NP", tattoos: "NP" };
const IN_EVERYWHERE = { studios: "IN", artists: "IN", tattoos: "IN" };

describe("the built Discover server, country-aware (D06.5)", { skip }, () => {
	let api: StubApi;
	/** Markets NP and IN, geolocation from X-Discover-Country. */
	let geo: Awaited<ReturnType<typeof startDiscover>>;
	/** Markets NP and IN, geolocation off (no DISCOVER_GEO_HEADER). */
	let noGeo: Awaited<ReturnType<typeof startDiscover>>;
	before(async () => {
		api = await stubApi(20);
		const markets = { DISCOVER_MARKETS: "NP,IN" };
		geo = await startDiscover(api.url, {
			...markets,
			DISCOVER_GEO_HEADER: "X-Discover-Country",
		});
		noGeo = await startDiscover(api.url, markets);
	});
	beforeEach(() => {
		api.requests.length = 0;
		api.scenario.count = 20;
	});
	after(() => {
		geo?.child.kill();
		noGeo?.child.kill();
		api?.close();
	});

	test("a first visit follows the trusted header: Nepal's or India's listings, never both", async () => {
		const india = await geo.get("/", {
			headers: { "X-Discover-Country": "IN" },
		});
		const indiaHtml = await india.text();
		assert.deepEqual(homeCountries(api.requests), IN_EVERYWHERE);
		const indiaText = text(indiaHtml);
		// Rows 3, 7, 11… are India's; 0, 1, 2… Nepal's.
		assert.match(indiaText, /Stub Studio 3\b/);
		assert.doesNotMatch(indiaText, /Stub Studio 2\b|Stub Studio 0\b|Stub Ink/);
		assert.doesNotMatch(indiaText, /Pokhara|Kathmandu/);
		// The selector names the country; India is marked current.
		assert.match(
			indiaHtml,
			/<summary[^>]*>.*?<span class="sr-only">Country: <\/span><span[^>]*>India<\/span>/,
		);
		assert.match(indiaHtml, /value="IN" aria-current="true"/);

		api.requests.length = 0;
		const nepalHtml = await (
			await geo.get("/", { headers: { "X-Discover-Country": "np" } })
		).text();
		assert.deepEqual(homeCountries(api.requests), NP_EVERYWHERE);
		assert.match(text(nepalHtml), /Stub Studio 2\b/);
		assert.doesNotMatch(text(nepalHtml), /Stub Studio 3\b/);
	});

	test("the saved cookie beats the header; an explicit ?country= beats both", async () => {
		await geo.get("/", {
			headers: { "X-Discover-Country": "IN", Cookie: "td_country=NP" },
		});
		assert.deepEqual(homeCountries(api.requests), NP_EVERYWHERE);

		api.requests.length = 0;
		const explicit = await geo.get("/?country=in", {
			headers: { "X-Discover-Country": "NP", Cookie: "td_country=NP" },
		});
		assert.deepEqual(homeCountries(api.requests), IN_EVERYWHERE);
		const html = await explicit.text();
		// A ?country= variant is never indexed and canonicalises to the bare path.
		assert.equal(explicit.headers.get("x-robots-tag"), "noindex, nofollow");
		assert.match(html, /<meta name="robots" content="noindex, nofollow"\/>/);
		assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/"/>`));
		assert.doesNotMatch(html, /rel="canonical" href="[^"]*\?/);
	});

	test("a malformed or unassigned ?country= is ignored, as is a cookie that isn't a market", async () => {
		for (const search of ["?country=XX1", "?country=XX", "?country=nepal"]) {
			api.requests.length = 0;
			const response = await geo.get(`/${search}`, {
				headers: { Cookie: "td_country=US", "X-Discover-Country": "IN" },
			});
			assert.equal(response.status, 200, search);
			assert.deepEqual(homeCountries(api.requests), IN_EVERYWHERE, search);
		}
	});

	test("with geolocation off, a spoofed CF-IPCountry or internal header changes nothing", async () => {
		await noGeo.get("/", {
			headers: { "CF-IPCountry": "IN", "X-Discover-Country": "IN" },
		});
		assert.deepEqual(homeCountries(api.requests), NP_EVERYWHERE);
	});

	test("the places are the page's country's; styles stay global", async () => {
		await geo.get("/", { headers: { "X-Discover-Country": "IN" } });
		assert.ok(api.requests.includes("/api/v1/discover/locations"));
		assert.ok(api.requests.includes("/api/v1/discover/styles"));
		const nepal = await (await geo.get("/")).text();
		assert.match(nepal, /\/locations\/nepal\/pokhara/);
		assert.doesNotMatch(nepal, /href="[^"]*new-delhi/);
	});

	test("a country with nothing listed says so, offers the other market, and shows no one else's listings", async () => {
		api.scenario.count = 3; // all Nepal's
		const response = await geo.get("/", {
			headers: { "X-Discover-Country": "IN" },
		});
		assert.equal(response.status, 200);
		const html = await response.text();
		assert.match(
			html,
			/id="market-empty-title"[^>]*>No studios are listed in India yet\.</,
		);
		assert.match(
			html,
			/<button[^>]*value="NP"[^>]*>Studios in Nepal<\/button>/,
		);
		assert.doesNotMatch(text(html), /Stub /);
		assert.deepEqual(sections(html), []);
		for (const id of STATIC_BANDS) assert.match(html, new RegExp(`id="${id}"`));
		// Nepal itself has listings and no note.
		const nepal = await (await geo.get("/")).text();
		assert.doesNotMatch(nepal, /market-empty-title/);
	});

	test("the dehydrated router state carries the country the page rendered", async () => {
		const html = await (
			await geo.get("/", { headers: { "X-Discover-Country": "IN" } })
		).text();
		assert.match(html, /country:\$R\[\d+\]=\{country:"IN",source:"geo"\}/);
		assert.match(html, /markets:\$R\[\d+\]=\["NP","IN"\],defaultCountry:"NP"/);
		assert.match(
			html,
			/\["tattoo-drip","discover","studios",\$R\[\d+\]=\{limit:8,country:"IN"\}\]/,
		);
		assert.doesNotMatch(html, /x-discover-country|geoHeader/i);
		const explicit = await (
			await geo.get("/?country=IN", { headers: { Cookie: "td_country=NP" } })
		).text();
		// The root match's context: this page's country; the preference beside it.
		assert.match(
			explicit,
			/b:\$R\[\d+\]=\{country:\$R\[\d+\]=\{country:"IN",source:"url"\}\}/,
		);
		assert.match(explicit, /\{country:"NP",source:"cookie"\}/);
	});

	test("/explore/studios and /explore/artists use the resolved country when the address names none", async () => {
		const studios = await (
			await geo.get("/explore/studios?q=stub&style=blackwork", {
				headers: { "X-Discover-Country": "IN" },
			})
		).text();
		assert.deepEqual(sentTo(api.requests, "studios"), [
			{ q: "stub", country: "IN", style: "blackwork", limit: "24" },
		]);
		assert.match(studios, /Tattoo studios in India that list themselves/);
		// The form posts back to this very address.
		assert.match(
			studios,
			/name="return" value="\/explore\/studios\?q=stub&amp;style=blackwork"/,
		);
		// Removing the style keeps the country implicit.
		assert.match(studios, /href="\/explore\/studios\?q=stub"/);

		api.requests.length = 0;
		const artists = await (
			await geo.get("/explore/artists", {
				headers: { "X-Discover-Country": "IN" },
			})
		).text();
		assert.deepEqual(sentTo(api.requests, "artists"), [
			{ country: "IN", limit: "24" },
		]);
		assert.match(text(artists), /Stub Artist 3\b/);
		assert.doesNotMatch(text(artists), /Stub Artist 2\b/);

		api.requests.length = 0;
		api.scenario.count = 3;
		const empty = await (await geo.get("/explore/artists?country=IN")).text();
		assert.match(empty, /No artists are listed in India yet\./);
	});

	test("POST /preferences/country: the cookie's attributes, a same-origin redirect that swaps the country", async () => {
		const form = (fields: Record<string, string>, headers = {}) =>
			geo.get("/preferences/country", {
				method: "POST",
				redirect: "manual",
				headers,
				body: new URLSearchParams(fields),
			});
		const switched = await form({
			country: "in",
			return: "/explore/studios?q=stub&country=NP&city=pokhara&style=blackwork",
		});
		assert.equal(switched.status, 303);
		assert.equal(
			switched.headers.get("location"),
			"/explore/studios?q=stub&country=IN&style=blackwork",
		);
		// A cursor belongs to the old country's list: the new one starts at its first page.
		const paged = await form({
			country: "IN",
			return: "/explore/studios?country=NP&sort=name&cursor=abc",
		});
		assert.equal(
			paged.headers.get("location"),
			"/explore/studios?country=IN&sort=name",
		);
		// DISCOVER_URL is http://localhost here, so no Secure; https adds it (unit test).
		assert.equal(
			switched.headers.get("set-cookie"),
			"td_country=IN; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly",
		);
		assert.equal(switched.headers.get("cache-control"), "no-store");

		for (const back of [
			"https://evil.example/",
			"//evil.example/x",
			"/\\evil.example",
			"/..//evil.example/",
			"/.//evil.example",
			"/a/..//evil.example",
			"/%2e%2e//evil.example",
		]) {
			// Both answers: a saved market, and a country that isn't one.
			for (const country of ["NP", "US"]) {
				const answer = await form({ country, return: back });
				assert.equal(answer.headers.get("location"), "/", `${country} ${back}`);
			}
		}
		const notMarket = await form({ country: "US", return: "/pricing" });
		assert.equal(notMarket.headers.get("location"), "/pricing");
		assert.equal(notMarket.headers.get("set-cookie"), null);
		const crossSite = await form(
			{ country: "NP" },
			{ "Sec-Fetch-Site": "cross-site" },
		);
		assert.equal(crossSite.status, 403);
		const json = await form(
			{ country: "NP", return: "/" },
			{ Accept: "application/json" },
		);
		assert.deepEqual(await json.json(), { country: "NP" });

		// The saved cookie is what the next page reads.
		api.requests.length = 0;
		await geo.get("/", {
			headers: {
				Cookie: (switched.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
				"X-Discover-Country": "NP",
			},
		});
		assert.deepEqual(homeCountries(api.requests), IN_EVERYWHERE);
	});

	test("every HTML page is private and never stored; robots.txt and assets keep their caching", async () => {
		for (const path of [
			"/",
			"/for-studios",
			"/explore/studios",
			"/no-such-page",
		]) {
			const response = await geo.get(path);
			assert.equal(
				response.headers.get("cache-control"),
				"private, no-store",
				path,
			);
			assert.match(response.headers.get("vary") ?? "", /Cookie/, path);
		}
		const robots = await geo.get("/robots.txt");
		assert.equal(robots.headers.get("cache-control"), "public, max-age=300");
		const html = await (await geo.get("/for-studios")).text();
		const css = html.match(/href="(\/assets\/[^"]+\.css)"/)?.[1];
		assert.ok(css, "a stylesheet");
		const asset = await geo.get(css);
		assert.equal(asset.status, 200);
		assert.doesNotMatch(
			asset.headers.get("cache-control") ?? "",
			/no-store|private/,
		);
	});

	test("profile links carry no country, and nothing redirects by country", async () => {
		const response = await geo.get("/", {
			headers: { "X-Discover-Country": "IN" },
			redirect: "manual",
		});
		assert.equal(response.status, 200);
		const html = await response.text();
		const profiles = [
			...html.matchAll(/href="(\/(?:studios|artists)\/[^"]+)"/g),
		].map((match) => match[1] as string);
		assert.ok(profiles.some((href) => href.includes("stub-studio-3")));
		for (const href of profiles) assert.doesNotMatch(href, /country=/, href);
	});
});

describe("the built Discover server, one market", { skip }, () => {
	let api: StubApi;
	let discover: Awaited<ReturnType<typeof startDiscover>>;
	before(async () => {
		api = await stubApi(3);
		discover = await startDiscover(api.url);
	});
	after(() => {
		discover?.child.kill();
		api?.close();
	});

	test("the header names the country without a pointless picker; an explicit other country offers the market", async () => {
		const html = await (await discover.get("/for-studios")).text();
		assert.doesNotMatch(html, /<details/);
		assert.match(html, /<span class="sr-only">Country: <\/span>Nepal/);
		const india = await (await discover.get("/?country=IN")).text();
		assert.match(india, /<details/);
		assert.match(india, /No studios are listed in India yet\./);
		assert.match(india, /value="NP"/);
	});
});
