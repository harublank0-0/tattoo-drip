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
import { type StubApi, stubApi } from "./stub-api.ts";

/**
 * D07 on the built server (needs `pnpm build`): the studio and artist
 * directories (every control reaches the API, cursor paging, states), the
 * style pages and the location pages, against the stub API with markets
 * NP and IN and geolocation from X-Discover-Country. The stub honours the
 * API's parameters (test/stub-api.ts); `sentTo` reads what each request
 * asked for.
 */

const html = async (response: Response) => response.text();

/** Every `href` on a page, entities decoded. */
function hrefs(page: string): string[] {
	return [...page.matchAll(/href="([^"]+)"/g)].map((match) =>
		(match[1] as string).replace(/&amp;/g, "&"),
	);
}

/** The query of the first link whose text matches, as an object. */
function linkQuery(page: string, label: RegExp): Record<string, string> {
	const match = [
		...page.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g),
	].find((each) => label.test(text(each[2] as string).trim()));
	assert.ok(match, `a link named ${label}`);
	return Object.fromEntries(
		new URL((match[1] as string).replace(/&amp;/g, "&"), "http://x")
			.searchParams,
	);
}

describe("D07 directories on the built server", { skip }, () => {
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
		api.scenario.extraPlaces = [];
	});
	after(() => {
		discover?.child.kill();
		api?.close();
	});

	test("directories default to the resolved country; an explicit country beats the cookie and geolocation", async () => {
		await discover.get("/explore/artists", {
			headers: { "X-Discover-Country": "IN" },
		});
		assert.deepEqual(sentTo(api.requests, "artists"), [
			{ country: "IN", limit: "24" },
		]);
		api.requests.length = 0;
		await discover.get("/explore/studios?country=NP", {
			headers: { Cookie: "td_country=IN", "X-Discover-Country": "IN" },
		});
		assert.deepEqual(sentTo(api.requests, "studios"), [
			{ country: "NP", limit: "24" },
		]);
	});

	test("artists: q, city, style, who and sort all reach the API together, and the results follow", async () => {
		const response = await discover.get(
			"/explore/artists?q=Stub&country=NP&city=kathmandu&style=fine-line&sort=name&independent=false",
		);
		assert.equal(response.status, 200);
		const page = await html(response);
		assert.deepEqual(sentTo(api.requests, "artists"), [
			{
				q: "Stub",
				country: "NP",
				city: "kathmandu",
				style: "fine-line",
				independent: "false",
				sort: "name",
				limit: "24",
			},
		]);
		// The page's recent work: the same country, city and style.
		assert.deepEqual(sentTo(api.requests, "tattoos"), [
			{ country: "NP", city: "kathmandu", style: "fine-line", limit: "48" },
		]);
		// Artists 1 and 13 are Kathmandu's fine-line artists, by name.
		const words = text(page);
		assert.match(words, /Stub Artist 1 .*Stub Artist 13 /);
		assert.doesNotMatch(words, /Stub Artist 2\b/);
		assert.match(words, /at Stub Studio 1 · Kathmandu/);
		// The controls show the address; chips name the filters.
		assert.match(
			page,
			/<option value="kathmandu" selected="">Kathmandu<\/option>/,
		);
		assert.match(
			page,
			/<option value="name" selected="">Name, A to Z<\/option>/,
		);
		assert.match(
			page,
			/<option value="false" selected="">At a studio<\/option>/,
		);
		assert.match(page, />At a studio<svg/);
		assert.match(page, /“Stub”/);
		assert.match(
			page,
			/<title>Artists matching &quot;Stub&quot; \| Tattoo Drip<\/title>/,
		);
		assertInternalLinksExist(page);
	});

	test("studios: the sort reaches the API; unknown sorts, cursors and flags are dropped", async () => {
		await discover.get("/explore/studios?sort=-name");
		assert.deepEqual(sentTo(api.requests, "studios"), [
			{ country: "NP", sort: "-name", limit: "24" },
		]);
		for (const search of [
			"sort=rating",
			"sort=newest",
			"cursor=bad%20cursor!",
			"independent=true",
			"limit=48",
			"page=2",
			"q=x",
		]) {
			api.requests.length = 0;
			const response = await discover.get(`/explore/studios?${search}`);
			assert.equal(response.status, 200, search);
			assert.deepEqual(
				sentTo(api.requests, "studios"),
				[{ country: "NP", limit: "24" }],
				search,
			);
		}
		api.requests.length = 0;
		await discover.get("/explore/artists?independent=maybe&sort=popular");
		assert.deepEqual(sentTo(api.requests, "artists"), [
			{ country: "NP", limit: "24" },
		]);
	});

	test("no-JavaScript forms: the filters are a GET form and the search keeps them", async () => {
		const page = await html(
			await discover.get("/explore/studios?style=blackwork&sort=name"),
		);
		assert.match(
			page,
			/<form aria-label="Filter studios"[^>]*action="\/explore\/studios" method="get"/,
		);
		assert.match(page, /<select[^>]*name="style"/);
		assert.match(page, /<select[^>]*name="city"/);
		assert.match(page, /<select[^>]*name="sort"/);
		// The city needs a country: the toolbar always sends the page's.
		assert.match(page, /<input type="hidden" name="country" value="NP"\/>/);
		// The search box carries the filters as hidden fields, not q itself.
		const search = page.slice(
			page.indexOf("<search"),
			page.indexOf("</search>"),
		);
		assert.match(search, /name="style" value="blackwork"/);
		assert.match(search, /name="sort" value="name"/);
		assert.doesNotMatch(search, /type="hidden" name="q"/);
		assert.match(search, /<label[^>]*>Search studios by name<\/label>/);
		// The mobile Filters button (JavaScript) and the toolbar's Apply, shown
		// with or without JavaScript: a select's change never navigates.
		assert.match(page, />Filters \(1\)</);
		const toolbar = page.slice(
			page.indexOf('<form aria-label="Filter studios"'),
			page.indexOf(
				"</form>",
				page.indexOf('<form aria-label="Filter studios"'),
			),
		);
		assert.match(toolbar, /<button[^>]*type="submit"[^>]*>Apply<\/button>/);
		assert.doesNotMatch(toolbar, /noscript:inline-flex/);
		// A GET submission without JavaScript (empty selects) is read as the filters.
		api.requests.length = 0;
		await discover.get(
			"/explore/studios?country=NP&style=&city=pokhara&sort=newest",
		);
		assert.deepEqual(sentTo(api.requests, "studios"), [
			{ country: "NP", city: "pokhara", limit: "24" },
		]);
	});

	test("cursor paging: Next page keeps the filters, First page drops the cursor, a filter change starts again", async () => {
		api.scenario.count = 40; // 30 of Nepal's: two pages
		const first = await html(
			await discover.get("/explore/studios?q=stub&sort=name"),
		);
		assert.deepEqual(sentTo(api.requests, "studios"), [
			{ q: "stub", sort: "name", country: "NP", limit: "24" },
		]);
		const next = linkQuery(first, /^Next page$/);
		assert.equal(next.q, "stub");
		assert.equal(next.sort, "name");
		assert.ok(next.cursor);
		assert.doesNotMatch(text(first), /First page|Previous page/);
		// No totals, no page numbers.
		assert.doesNotMatch(text(first), /\bof \d+\b|Page \d/);

		api.requests.length = 0;
		const second = await html(
			await discover.get(`/explore/studios?${new URLSearchParams(next)}`),
		);
		assert.deepEqual(sentTo(api.requests, "studios"), [
			{ ...next, country: "NP", limit: "24" },
		]);
		// 30 rows: 24, then 6.
		assert.equal((second.match(/Visit studio site/g) ?? []).length, 6);
		assert.doesNotMatch(text(second), /Next page/);
		assert.deepEqual(linkQuery(second, /^First page$/), {
			q: "stub",
			sort: "name",
		});
		// Removing the search, resetting, changing a filter: no cursor.
		for (const label of [/^“stub”/, /^Reset$/]) {
			const query = linkQuery(second, label);
			assert.equal(query.cursor, undefined, String(label));
		}
		for (const href of hrefs(second).filter((each) =>
			each.startsWith("/explore/studios?"),
		)) {
			if (!/^\/explore\/studios\?(q=stub&)?sort=name&cursor=/.test(href))
				assert.doesNotMatch(href, /cursor=/, href);
		}
	});

	test("a cursor the API refuses (another sort, edited) goes back to the first page of the same filters", async () => {
		api.scenario.count = 40;
		const first = await html(await discover.get("/explore/studios?sort=name"));
		const { cursor } = linkQuery(first, /^Next page$/);
		const response = await discover.get(
			`/explore/studios?sort=-name&style=blackwork&cursor=${cursor}`,
			{ redirect: "manual" },
		);
		assert.ok([302, 307].includes(response.status), String(response.status));
		const location = new URL(
			response.headers.get("location") ?? "",
			"http://x",
		);
		assert.equal(location.pathname, "/explore/studios");
		assert.deepEqual(Object.fromEntries(location.searchParams), {
			style: "blackwork",
			sort: "-name",
		});
	});

	test("empty results: a filtered empty state with real actions; an empty market; never another country", async () => {
		const none = await html(
			await discover.get("/explore/studios?q=zzzz&country=NP&city=pokhara"),
		);
		assert.match(
			none,
			/No studios match &quot;zzzz&quot;|No studios match "zzzz"/,
		);
		assert.deepEqual(linkQuery(none, /^Clear filters$/), { country: "NP" });
		assert.deepEqual(linkQuery(none, /^All of Nepal$/), {
			q: "zzzz",
			country: "NP",
		});
		assert.match(none, /href="\/styles\/blackwork"/);
		assert.match(
			none,
			/<button[^>]*value="IN"[^>]*>Studios in India<\/button>/,
		);
		assert.doesNotMatch(text(none), /Stub Studio/);
		assert.match(none, /<output class="sr-only">No studios found\.</);

		api.scenario.count = 3; // all Nepal's
		const india = await html(await discover.get("/explore/studios?country=IN"));
		assert.match(india, /No studios are listed in India yet\./);
		assert.doesNotMatch(text(india), /Stub /);
		assert.deepEqual(sentTo(api.requests, "studios").at(-1), {
			country: "IN",
			limit: "24",
		});
	});

	test("search text stays text: ?q=true, ?q=null, ?q=007 are searches, never a redirect", async () => {
		for (const q of ["true", "null", "007", "1e3"]) {
			api.requests.length = 0;
			const response = await discover.get(`/explore/studios?q=${q}`, {
				redirect: "manual",
			});
			assert.equal(response.status, 200, q);
			assert.deepEqual(sentTo(api.requests, "studios"), [
				{ q, country: "NP", limit: "24" },
			]);
			assert.match(
				await html(response),
				new RegExp(`<title>Studios matching &quot;${q}&quot;`),
			);
		}
		// Booleans still read as the filter they are.
		api.requests.length = 0;
		const independent = await discover.get(
			"/explore/artists?independent=true",
			{
				redirect: "manual",
			},
		);
		assert.equal(independent.status, 200);
		assert.equal(sentTo(api.requests, "artists")[0]?.independent, "true");
	});

	test("a search with a control character is dropped, never sent (the API refuses it)", async () => {
		const response = await discover.get("/explore/studios?q=ab%01c");
		assert.equal(response.status, 200);
		assert.deepEqual(sentTo(api.requests, "studios"), [
			{ country: "NP", limit: "24" },
		]);
		// The stub refuses it as the API does.
		const direct = await fetch(`${api.url}/api/v1/discover/studios?q=ab%01c`);
		assert.equal(direct.status, 422);
	});

	test("a style that can't be checked (/styles down) is dropped, and the page says so", async () => {
		api.scenario.fail.add("styles");
		const response = await discover.get("/explore/studios?style=blackwork");
		assert.equal(response.status, 200);
		assert.deepEqual(sentTo(api.requests, "studios"), [
			{ country: "NP", limit: "24" },
		]);
		assert.match(
			await html(response),
			/Styles are unavailable right now, so this list isn(’|'|&#x27;)t filtered by style\./,
		);
		// No style asked for: nothing to say.
		assert.doesNotMatch(
			await html(await discover.get("/explore/studios")),
			/Styles are unavailable/,
		);
		api.scenario.fail.clear();
		assert.doesNotMatch(
			await html(await discover.get("/explore/studios?style=blackwork")),
			/Styles are unavailable/,
		);
	});

	test("an API failure is the error state with Try again (500, noindex)", async () => {
		api.scenario.fail.add("artists");
		const response = await discover.get("/explore/artists?style=realism");
		assert.equal(response.status, 500);
		const page = await html(response);
		assert.match(page, /Discover is unavailable for a moment/);
		assert.match(page, />Try again</);
		assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
	});

	test("destinations: tenant-scoped artist slugs stay apart; independents link to their own business", async () => {
		const nepal = await html(await discover.get("/explore/artists"));
		// Artists 5 and 6 are both `maya`, at two studios.
		const maya = hrefs(nepal).filter((href) => href.endsWith("/artists/maya"));
		assert.deepEqual(maya, [
			"http://stub-studio-5.localhost:3000/artists/maya",
			"http://stub-studio-6.localhost:3000/artists/maya",
		]);
		const india = await html(await discover.get("/explore/artists?country=IN"));
		assert.match(india, /Independent · New Delhi/);
		assert.match(
			india,
			/href="http:\/\/stub-solo-3\.localhost:3000\/artists\/stub-artist-3"/,
		);
		// Screen readers hear where each link goes: an independent's own site,
		// a studio artist's page on the studio's site (India's are all independent).
		assert.match(
			india,
			/stub-artist-3"[^>]*>[\s\S]*?<span class="sr-only">\(their own site\)<\/span><\/a>/,
		);
		assert.doesNotMatch(india, /their page on the studio/);
		assert.match(nepal, /\(their page on the studio(’|'|&#x27;)s site\)/);
		assert.doesNotMatch(nepal, /their own site/);
		// The location pages' recent work says the same.
		const indiaHub = await html(await discover.get("/locations/india"));
		assert.match(indiaHub, /Fresh from India/);
		assert.match(indiaHub, /<span class="sr-only">\(their own site\)<\/span>/);
		assert.doesNotMatch(indiaHub, /their page on the studio/);
		// No Discover profile route exists yet, so none is linked.
		for (const page of [nepal, india])
			assert.doesNotMatch(page, /href="\/(studios|artists|tattoos)\//);
	});

	test("titles, canonicals and noindex: bare directory vs any parameter; pages stay private", async () => {
		const bare = await discover.get("/explore/studios");
		assert.equal(bare.headers.get("cache-control"), "private, no-store");
		const bareHtml = await html(bare);
		assert.match(
			bareHtml,
			/<title>Tattoo studios in Nepal \| Tattoo Drip<\/title>/,
		);
		assert.match(
			bareHtml,
			new RegExp(`<link rel="canonical" href="${SITE}/explore/studios"/>`),
		);
		const filtered = await html(
			await discover.get(
				"/explore/studios?country=NP&city=kathmandu&style=blackwork",
			),
		);
		assert.match(
			filtered,
			/<title>Blackwork tattoo studios in Kathmandu \| Tattoo Drip<\/title>/,
		);
		assert.match(
			filtered,
			new RegExp(`<link rel="canonical" href="${SITE}/explore/studios"/>`),
		);
		assert.equal(filtered.match(/<meta name="robots"/g)?.length, 1);
	});
});

describe("D07 style and location pages on the built server", { skip }, () => {
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
		api.scenario.extraPlaces = [];
	});
	after(() => {
		discover?.child.kill();
		api?.close();
	});

	test("a style's page: its studios, artists and work in the page's country, linking to the filtered directories", async () => {
		const response = await discover.get("/styles/blackwork");
		assert.equal(response.status, 200);
		const page = await html(response);
		for (const endpoint of ["studios", "artists", "tattoos"])
			assert.deepEqual(
				sentTo(api.requests, endpoint).map(({ country, style }) => ({
					country,
					style,
				})),
				[{ country: "NP", style: "blackwork" }],
				endpoint,
			);
		assert.match(page, /<h1[^>]*>Blackwork<\/h1>/);
		assert.match(
			page,
			/<title>Blackwork tattoo studios and artists in Nepal \| Tattoo Drip<\/title>/,
		);
		assert.deepEqual(linkQuery(page, /^Browse all Blackwork studios$/), {
			style: "blackwork",
		});
		assert.deepEqual(linkQuery(page, /^Browse all Blackwork artists$/), {
			style: "blackwork",
		});
		assert.match(page, /href="\/styles\/realism"/);
		assert.doesNotMatch(page, /href="\/styles\/blackwork"/);
		assert.match(
			page,
			new RegExp(`<link rel="canonical" href="${SITE}/styles/blackwork"/>`),
		);
		assertInternalLinksExist(page);
	});

	test("a style's page is country-aware: geolocation, cookie, and an explicit country that travels on", async () => {
		await discover.get("/styles/traditional", {
			headers: { "X-Discover-Country": "IN" },
		});
		assert.equal(sentTo(api.requests, "studios")[0]?.country, "IN");
		api.requests.length = 0;
		const explicit = await html(
			await discover.get("/styles/traditional?country=IN", {
				headers: { Cookie: "td_country=NP" },
			}),
		);
		assert.equal(sentTo(api.requests, "artists")[0]?.country, "IN");
		assert.deepEqual(linkQuery(explicit, /^Browse all Traditional studios$/), {
			style: "traditional",
			country: "IN",
		});
		assert.match(explicit, /href="\/styles\/blackwork\?country=IN"/);
	});

	test("an unknown or malformed style is the 404 page; an empty style says so and offers others", async () => {
		for (const path of [
			"/styles/glitter",
			"/styles/Not_A_Slug",
			"/styles/x%2Fy",
		]) {
			const response = await discover.get(path);
			assert.equal(response.status, 404, path);
			const page = await html(response);
			assert.match(page, /Nothing here/, path);
			assert.match(page, /<title>Page not found \| Tattoo Drip<\/title>/, path);
		}
		// Geometric is style 5: no Nepal row has it among 3.
		api.scenario.count = 3;
		const empty = await html(await discover.get("/styles/geometric"));
		assert.match(empty, /Nothing is listed under Geometric in Nepal yet\./);
		assert.match(empty, /href="\/styles\/blackwork"/);
		assert.doesNotMatch(text(empty), /Stub /);
		// The style list failing is an error page, not a 404.
		api.scenario.fail.add("styles");
		assert.equal((await discover.get("/styles/blackwork")).status, 500);
	});

	test("a country page: its own country whatever the visitor's, its places, previews and directory links", async () => {
		const response = await discover.get("/locations/nepal", {
			headers: { Cookie: "td_country=IN", "X-Discover-Country": "IN" },
		});
		assert.equal(response.status, 200);
		const page = await html(response);
		for (const endpoint of ["studios", "artists", "tattoos"])
			assert.equal(sentTo(api.requests, endpoint)[0]?.country, "NP", endpoint);
		assert.match(page, /<h1[^>]*>Nepal<\/h1>/);
		assert.match(page, /href="\/locations\/nepal\/pokhara"/);
		assert.match(page, /href="\/locations\/nepal\/kathmandu"/);
		assert.doesNotMatch(page, /href="[^"]*new-delhi/);
		assert.deepEqual(linkQuery(page, /^All studios in Nepal$/), {
			country: "NP",
		});
		assert.deepEqual(linkQuery(page, /^All artists in Nepal$/), {
			country: "NP",
		});
		assert.doesNotMatch(text(page), /New Delhi|Stub Studio 3\b/);
		assert.match(
			page,
			new RegExp(`<link rel="canonical" href="${SITE}/locations/nepal"/>`),
		);
		assert.match(
			page,
			/<title>Tattoo studios and artists in Nepal \| Tattoo Drip<\/title>/,
		);
		assertInternalLinksExist(page);
		// An explicit ?country= doesn't change it either.
		api.requests.length = 0;
		await discover.get("/locations/nepal?country=IN");
		assert.equal(sentTo(api.requests, "studios")[0]?.country, "NP");
	});

	test("only a configured market has a location page; a market with nothing listed says so", async () => {
		for (const path of [
			"/locations/united-states",
			"/locations/np",
			"/locations/NP",
			"/locations/Nepal",
		]) {
			const response = await discover.get(path);
			assert.equal(response.status, 404, path);
		}
		api.scenario.count = 3; // all Nepal's
		const india = await discover.get("/locations/india");
		assert.equal(india.status, 200);
		const page = await html(india);
		assert.match(page, /No studios or artists are listed in India yet\./);
		assert.match(page, /href="\/locations\/nepal"/);
		assert.doesNotMatch(text(page), /Stub /);
	});

	test("a city page: city and country from the address, its studios, artists and styles", async () => {
		const response = await discover.get("/locations/nepal/kathmandu", {
			headers: { Cookie: "td_country=IN" },
		});
		assert.equal(response.status, 200);
		const page = await html(response);
		for (const endpoint of ["studios", "artists", "tattoos"])
			assert.deepEqual(
				sentTo(api.requests, endpoint).map(({ country, city }) => ({
					country,
					city,
				})),
				[{ country: "NP", city: "kathmandu" }],
				endpoint,
			);
		assert.match(page, /<h1[^>]*>Kathmandu<\/h1>/);
		assert.match(page, /Bagmati, Nepal/);
		assert.match(
			page,
			/<title>Tattoo studios and artists in Kathmandu, Nepal \| Tattoo Drip<\/title>/,
		);
		assert.match(page, /href="\/locations\/nepal"/);
		assert.deepEqual(linkQuery(page, /^All studios in Kathmandu$/), {
			country: "NP",
			city: "kathmandu",
		});
		// Kathmandu's rows are 1, 5, 9, 13, 17: fine line, geometric, realism, fine line, geometric.
		assert.deepEqual(linkQuery(page, /^Fine line$/), {
			country: "NP",
			city: "kathmandu",
			style: "fine-line",
		});
		assert.doesNotMatch(page, /city=kathmandu&amp;style=blackwork/);
		assert.match(page, /href="\/locations\/nepal\/pokhara"/);
		assertInternalLinksExist(page);
	});

	test("an unknown city, or another country's, is the 404 page; a listed place with nothing in it is an empty state", async () => {
		for (const path of [
			"/locations/nepal/atlantis",
			"/locations/nepal/new-delhi",
			"/locations/india/pokhara",
			"/locations/united-states/new-york",
			"/locations/nepal/Kathmandu",
		]) {
			const response = await discover.get(path);
			assert.equal(response.status, 404, path);
		}
		api.scenario.extraPlaces = [
			{
				country: "NP",
				slug: "bhaktapur",
				name: "Bhaktapur",
				region: "Bagmati",
			},
		];
		const empty = await discover.get("/locations/nepal/bhaktapur");
		assert.equal(empty.status, 200);
		const page = await html(empty);
		assert.match(
			page,
			/No studios or artists are listed in Bhaktapur right now\./,
		);
		assert.doesNotMatch(text(page), /Stub /);
		// The places list failing can't confirm a city: an error page, not a
		// guess. The country page does without its Cities section.
		api.scenario.fail.add("locations");
		const country = await discover.get("/locations/nepal");
		assert.equal(country.status, 200);
		const countryPage = await html(country);
		assert.doesNotMatch(countryPage, /Cities in Nepal/);
		assert.match(countryPage, /Recently listed studios in Nepal/);
		assert.equal(
			(await discover.get("/locations/nepal/kathmandu")).status,
			500,
		);
	});
});

describe("D07 pages with indexing on", { skip }, () => {
	let api: StubApi;
	let discover: Discover;
	before(async () => {
		api = await stubApi(3);
		discover = await startDiscover(api.url, { DISCOVER_INDEXING: "on" });
	});
	after(() => {
		discover?.child.kill();
		api?.close();
	});

	test("an empty style or location page is noindex; a listed one isn't", async () => {
		const robots = async (path: string) =>
			/<meta name="robots"/.test(await html(await discover.get(path)));
		assert.equal(await robots("/styles/blackwork"), false);
		assert.equal(await robots("/styles/geometric"), true);
		assert.equal(await robots("/locations/nepal/kathmandu"), false);
		assert.equal(await robots("/explore/artists"), false);
		assert.equal(await robots("/explore/artists?sort=name"), true);
	});
});
