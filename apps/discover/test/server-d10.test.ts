import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { freePort, SITE, skip, startDiscover, text } from "./built-server.ts";
import { type StubApi, stubApi } from "./stub-api.ts";

/**
 * D10 phase A on the built server, without JavaScript (the HTML as served):
 * every route's head (one title, description, canonical and robots; Open
 * Graph and Twitter), the robots decision ("noindex, follow" while
 * indexing is on), JSON-LD (parsed and checked against the visible page),
 * the sitemap index and its children (parsed; eligibility, paging,
 * headers), robots.txt, status semantics and the production origin.
 */

type Discover = Awaited<ReturnType<typeof startDiscover>>;

const uuid = (kind: number, index: number) =>
	`00000000-0000-4000-8000-${String(kind).padStart(4, "0")}${String(index).padStart(8, "0")}`;

/** The decoded value of an attribute-escaped string. */
const decodeEntities = (value: string) =>
	value
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");

/** Every `<meta>` whose name or property is `key`, by content. */
function metas(page: string, key: string): string[] {
	return [
		...page.matchAll(
			new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"/>`, "g"),
		),
	].map((match) => decodeEntities(match[1] as string));
}

function head(page: string) {
	const titles = [...page.matchAll(/<title>([^<]*)<\/title>/g)].map((match) =>
		decodeEntities(match[1] as string),
	);
	const canonicals = [
		...page.matchAll(/<link rel="canonical" href="([^"]*)"\/>/g),
	].map((match) => decodeEntities(match[1] as string));
	return {
		titles,
		canonicals,
		description: metas(page, "description"),
		robots: metas(page, "robots"),
		og: Object.fromEntries(
			[
				"og:title",
				"og:description",
				"og:url",
				"og:image",
				"og:type",
				"og:site_name",
				"twitter:card",
			].map((key) => [key, metas(page, key)]),
		),
	};
}

/** The page's JSON-LD scripts, parsed (the raw text must hold no `<` but its own tags). */
function jsonLd(page: string): Record<string, unknown>[] {
	return [
		...page.matchAll(
			/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
		),
	].map((match) => {
		const raw = match[1] as string;
		assert.doesNotMatch(raw, /[<>]/, "JSON-LD escapes < and >");
		return JSON.parse(raw);
	});
}

function graph(page: string): Record<string, unknown>[] {
	const scripts = jsonLd(page);
	assert.equal(scripts.length, 1, "one JSON-LD script");
	const [script] = scripts as [{ "@context": string; "@graph": [] }];
	assert.equal(script["@context"], "https://schema.org");
	return script["@graph"];
}

const ofType = (nodes: Record<string, unknown>[], type: string) =>
	nodes.find((node) => node["@type"] === type) as Record<string, never>;

/** The visible breadcrumb labels (the `Breadcrumb` nav). */
function visibleCrumbs(page: string): string[] {
	const nav = /<nav aria-label="Breadcrumb">([\s\S]*?)<\/nav>/.exec(page)?.[1];
	assert.ok(nav, "breadcrumbs");
	return [...nav.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((match) =>
		decodeEntities(
			text(match[1] as string)
				.replace(/\s*\/\s*$/, "")
				.trim(),
		),
	);
}

/**
 * A small XML well-formedness check: balanced tags, attribute-free text
 * with only the five predefined entities, one root. Returns the root's
 * name and every `<loc>`.
 */
function parseXml(xml: string): { root: string; locs: string[] } {
	assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n/);
	const body = xml.replace(/^<\?xml[^>]*\?>\n/, "");
	const stack: string[] = [];
	let root = "";
	const locs: string[] = [];
	const tokens = body.split(/(<[^>]+>)/).filter((token) => token !== "");
	let last = "";
	for (const token of tokens) {
		if (token.startsWith("</")) {
			const name = token.slice(2, -1);
			assert.equal(stack.pop(), name, `closing ${name}`);
		} else if (token.startsWith("<")) {
			assert.doesNotMatch(token, /\/>$/);
			const name = /^<([a-z]+)/i.exec(token)?.[1] as string;
			if (stack.length === 0) {
				assert.equal(root, "", "one root");
				root = name;
			}
			stack.push(name);
			last = name;
		} else {
			assert.doesNotMatch(token, /</);
			assert.doesNotMatch(token, /&(?!(amp|lt|gt|quot|apos);)/, token);
			if (last === "loc" && stack.at(-1) === "loc")
				locs.push(decodeEntities(token));
		}
	}
	assert.deepEqual(stack, [], "every tag closed");
	return { root, locs };
}

async function sitemapLocs(discover: Discover, path: string) {
	const response = await discover.get(path);
	assert.equal(response.status, 200, path);
	assert.equal(
		response.headers.get("content-type"),
		"application/xml; charset=utf-8",
	);
	assert.equal(response.headers.get("cache-control"), "public, max-age=3600");
	return parseXml(await response.text());
}

/** Every page URL in every child of the index, by child. */
async function allSitemaps(discover: Discover) {
	const index = await sitemapLocs(discover, "/sitemap.xml");
	assert.equal(index.root, "sitemapindex");
	const children: Record<string, string[]> = {};
	for (const child of index.locs) {
		const url = new URL(child);
		const set = await sitemapLocs(discover, `${url.pathname}${url.search}`);
		assert.equal(set.root, "urlset");
		children[`${url.pathname}${url.search}`] = set.locs;
	}
	return children;
}

describe("D10 head, robots and structured data (indexing on)", { skip }, () => {
	let api: StubApi;
	let discover: Discover;
	before(async () => {
		api = await stubApi(20);
		discover = await startDiscover(api.url, { DISCOVER_INDEXING: "on" });
	});
	beforeEach(() => {
		api.scenario.count = 20;
		api.scenario.hidden.clear();
		api.scenario.fail.clear();
		api.scenario.sitemapPage = 5000;
	});
	after(() => {
		discover?.child.kill();
		api?.close();
	});

	test("every public route: one title, description, canonical; Open Graph and Twitter; the right robots and status", async () => {
		const photo = uuid(3, 0);
		// A 404 has no canonical address (and no og:url).
		const rows: [
			path: string,
			status: number,
			canonical: string | null,
			robots: string | null,
		][] = [
			["/", 200, `${SITE}/`, null],
			["/for-studios", 200, `${SITE}/for-studios`, null],
			["/pricing", 200, `${SITE}/pricing`, "noindex, follow"],
			["/explore/studios", 200, `${SITE}/explore/studios`, null],
			["/explore/artists", 200, `${SITE}/explore/artists`, null],
			[
				"/explore/studios?style=blackwork&sort=name",
				200,
				`${SITE}/explore/studios`,
				"noindex, follow",
			],
			["/tattoos", 200, `${SITE}/tattoos`, null],
			[`/tattoos/${photo}`, 200, `${SITE}/tattoos/${photo}`, null],
			["/styles/blackwork", 200, `${SITE}/styles/blackwork`, null],
			["/locations/nepal", 200, `${SITE}/locations/nepal`, null],
			[
				"/locations/nepal/kathmandu",
				200,
				`${SITE}/locations/nepal/kathmandu`,
				null,
			],
			["/studios/stub-studio-1", 200, `${SITE}/studios/stub-studio-1`, null],
			[
				"/studios/stub-studio-1/artists/crew-1-a",
				200,
				`${SITE}/studios/stub-studio-1/artists/crew-1-a`,
				null,
			],
			["/artists/stub-solo-3", 200, `${SITE}/artists/stub-solo-3`, null],
			// Tracking or any other parameter: the bare path's variant.
			[
				"/studios/stub-studio-1?utm_source=x",
				200,
				`${SITE}/studios/stub-studio-1`,
				"noindex, follow",
			],
			["/no-such-page", 404, null, "noindex, follow"],
			["/studios/nope-studio", 404, null, "noindex, follow"],
		];
		for (const [path, status, canonical, robots] of rows) {
			const response = await discover.get(path, { redirect: "manual" });
			assert.equal(response.status, status, path);
			assert.equal(response.headers.get("x-robots-tag"), robots, path);
			const tags = head(await response.text());
			assert.equal(tags.titles.length, 1, path);
			assert.match(tags.titles[0] as string, /Tattoo Drip/, path);
			assert.equal(tags.description.length, 1, path);
			assert.ok((tags.description[0] as string).length <= 160, path);
			assert.deepEqual(tags.canonicals, canonical ? [canonical] : [], path);
			assert.deepEqual(tags.robots, robots ? [robots] : [], path);
			for (const [key, values] of Object.entries(tags.og))
				if (key !== "og:url") assert.equal(values.length, 1, `${path} ${key}`);
			assert.deepEqual(tags.og["og:url"], canonical ? [canonical] : [], path);
			assert.deepEqual(tags.og["og:site_name"], ["Tattoo Drip"], path);
			assert.match(tags.og["og:image"]?.[0] as string, /^http/, path);
		}
	});

	test("titles from real data, accurate and distinct", async () => {
		const title = async (path: string) =>
			head(await (await discover.get(path)).text()).titles[0];
		assert.equal(
			await title("/studios/stub-studio-1"),
			"Stub Studio 1 — Tattoo studio in Kathmandu, Nepal | Tattoo Drip",
		);
		assert.equal(
			await title("/studios/stub-studio-1/artists/crew-1-a"),
			"Stub Crew 1A — Tattoo artist at Stub Studio 1 in Kathmandu | Tattoo Drip",
		);
		assert.equal(
			await title("/artists/stub-solo-3"),
			// ", India" would pass the title's budget: whole parts only.
			"Stub Artist 3 — Independent tattoo artist in New Delhi | Tattoo Drip",
		);
		assert.equal(
			await title("/locations/nepal/kathmandu"),
			"Tattoo studios and artists in Kathmandu, Nepal | Tattoo Drip",
		);
		assert.equal(
			await title("/styles/blackwork"),
			"Blackwork tattoo studios and artists in Nepal | Tattoo Drip",
		);
	});

	test("JSON-LD: the home page's WebSite and Organization", async () => {
		const nodes = graph(await (await discover.get("/")).text());
		const site = ofType(nodes, "WebSite");
		assert.equal(site.url, `${SITE}/`);
		assert.equal(
			(site.potentialAction as { target: { urlTemplate: string } }).target
				.urlTemplate,
			`${SITE}/explore/studios?q={search_term_string}`,
		);
		const org = ofType(nodes, "Organization");
		assert.equal(org.name, "Tattoo Drip");
		assert.equal(
			(org.logo as { url: string }).url,
			`${SITE}/brand/tattoo-drip-512.png`,
		);
		// The logo is a real file.
		const logo = await discover.get("/brand/tattoo-drip-512.png");
		assert.equal(logo.status, 200);
		assert.equal(logo.headers.get("content-type"), "image/png");
	});

	test("JSON-LD: a studio, its artist, an independent and an artwork match the visible page; no private field", async () => {
		const studioPage = await (
			await discover.get("/studios/stub-studio-1")
		).text();
		const studioNodes = graph(studioPage);
		const parlor = ofType(studioNodes, "TattooParlor");
		const h1 = (page: string) =>
			decodeEntities(
				text(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(page)?.[1] ?? "").trim(),
			);
		assert.equal(parlor.name, h1(studioPage));
		assert.equal(parlor.url, `${SITE}/studios/stub-studio-1`);
		assert.equal(parlor.image, "http://media.test/cover-1.jpg");
		assert.deepEqual(parlor.address, {
			"@type": "PostalAddress",
			addressLocality: "Kathmandu",
			addressRegion: "Bagmati",
			addressCountry: "NP",
		});
		// The https link only: the stub's javascript: "website" never.
		assert.deepEqual(parlor.sameAs, ["https://instagram.com/stub-studio-1"]);
		const crumbs = ofType(studioNodes, "BreadcrumbList").itemListElement as {
			name: string;
			item: string;
		}[];
		assert.deepEqual(
			crumbs.map((each) => each.name),
			visibleCrumbs(studioPage),
		);
		assert.equal(crumbs.at(-1)?.item, `${SITE}/studios/stub-studio-1`);

		const artistPage = await (
			await discover.get("/studios/stub-studio-1/artists/crew-1-a")
		).text();
		const person = ofType(graph(artistPage), "Person");
		assert.equal(person.name, h1(artistPage));
		assert.deepEqual(person.worksFor, {
			"@type": "TattooParlor",
			"@id": `${SITE}/studios/stub-studio-1#studio`,
			name: "Stub Studio 1",
			url: `${SITE}/studios/stub-studio-1`,
		});
		assert.deepEqual(
			(
				ofType(graph(artistPage), "BreadcrumbList").itemListElement as {
					name: string;
				}[]
			).map((each) => each.name),
			visibleCrumbs(artistPage),
		);

		const soloPage = await (await discover.get("/artists/stub-solo-3")).text();
		const solo = ofType(graph(soloPage), "Person");
		assert.equal(solo.url, `${SITE}/artists/stub-solo-3`);
		assert.equal("worksFor" in solo, false);

		const photo = uuid(3, 0);
		const artPage = await (await discover.get(`/tattoos/${photo}`)).text();
		const artNodes = graph(artPage);
		const image = ofType(artNodes, "ImageObject");
		assert.equal(image.contentUrl, "http://media.test/tattoo-0.jpg");
		assert.equal(image.width, 1200);
		assert.equal(image.height, 1500);
		assert.equal(image.url, `${SITE}/tattoos/${photo}`);
		assert.equal(image.name, h1(artPage));
		// The studio's name holds markup in the stub: escaped in the script, intact once parsed.
		assert.equal(
			image.caption,
			"Blackwork tattoo by Stub Artist 0 at Stub Ink <b>Studio</b>",
		);
		assert.deepEqual(image.creator, {
			"@type": "Person",
			name: "Stub Artist 0",
			url: `${SITE}/studios/stub-studio-0/artists/stub-artist-0`,
		});
		assert.deepEqual(
			(
				ofType(artNodes, "BreadcrumbList").itemListElement as { name: string }[]
			).map((each) => each.name),
			visibleCrumbs(artPage),
		);
		for (const page of [studioPage, artistPage, soloPage, artPage])
			assert.doesNotMatch(
				JSON.stringify(jsonLd(page)),
				/bookingUrl|\/book\?|ref=|aggregateRating|review|priceRange|openingHours|telephone|email|streetAddress|timezone/i,
			);
	});

	test("JSON-LD: hubs, directories and the gallery carry their breadcrumbs only", async () => {
		for (const path of [
			"/styles/blackwork",
			"/locations/nepal",
			"/locations/nepal/kathmandu",
			"/explore/studios",
			"/explore/artists",
			"/tattoos",
		]) {
			const page = await (await discover.get(path)).text();
			const nodes = graph(page);
			assert.deepEqual(
				nodes.map((node) => node["@type"]),
				["BreadcrumbList"],
				path,
			);
			const items = nodes[0]?.itemListElement as {
				name: string;
				item: string;
			}[];
			assert.deepEqual(
				items.map((each) => each.name),
				visibleCrumbs(page),
				path,
			);
			assert.equal(items.at(-1)?.item, `${SITE}${path}`, path);
		}
	});

	test("no JSON-LD on a page that isn't indexable: a variant, an empty hub, a 404, pricing", async () => {
		for (const path of [
			"/studios/stub-studio-1?country=NP",
			"/explore/studios?q=stub",
			"/styles/geometric?country=IN",
			"/studios/nope-studio",
			`/tattoos/${uuid(3, 999)}`,
			"/pricing",
		]) {
			const page = await (await discover.get(path)).text();
			assert.deepEqual(jsonLd(page), [], path);
		}
	});

	test("status: unknown, malformed and unpublished are 404; an API failure is a titled 500; both noindex, follow", async () => {
		api.scenario.hidden.add(uuid(3, 1));
		api.scenario.hidden.add("stub-studio-2");
		for (const path of [
			`/tattoos/${uuid(3, 1)}`,
			"/tattoos/not-an-id",
			"/studios/stub-studio-2",
			"/studios/Stub-Studio-1",
			"/styles/glitter",
			"/locations/atlantis",
		]) {
			const response = await discover.get(path, { redirect: "manual" });
			assert.equal(response.status, 404, path);
			assert.equal(
				response.headers.get("x-robots-tag"),
				"noindex, follow",
				path,
			);
			assert.match(
				await response.text(),
				/<title>Page not found \| Tattoo Drip<\/title>/,
				path,
			);
		}
		api.scenario.fail.add("studio");
		const down = await discover.get("/studios/stub-studio-1");
		assert.equal(down.status, 500);
		assert.equal(down.headers.get("x-robots-tag"), "noindex, follow");
		const page = await down.text();
		assert.match(
			page,
			/<title>Discover is unavailable for a moment \| Tattoo Drip<\/title>/,
		);
		assert.deepEqual(jsonLd(page), []);
		assert.equal(head(page).robots.length, 1);
	});

	test("a later page: noindex, follow, canonical to the bare path, its paging links kept", async () => {
		api.scenario.count = 60;
		const first = await (await discover.get("/explore/studios")).text();
		const next = /href="(\/explore\/studios\?cursor=[^"]+)"/.exec(first)?.[1];
		assert.ok(next, "a Next page link");
		const response = await discover.get(decodeEntities(next));
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("x-robots-tag"), "noindex, follow");
		const page = await response.text();
		assert.deepEqual(head(page).canonicals, [`${SITE}/explore/studios`]);
		assert.match(page, /href="\/explore\/studios"[^>]*>[\s\S]*?First page/);
		// Its rows still link to (indexable) profiles.
		assert.match(page, /href="\/studios\/stub-studio-/);
	});
});

describe("D10 sitemaps (indexing on)", { skip }, () => {
	let api: StubApi;
	let discover: Discover;
	before(async () => {
		api = await stubApi(20);
		discover = await startDiscover(api.url, { DISCOVER_INDEXING: "on" });
	});
	beforeEach(() => {
		api.scenario.count = 20;
		api.scenario.hidden.clear();
		api.scenario.fail.clear();
		api.scenario.sitemapPage = 5000;
	});
	after(() => {
		discover?.child.kill();
		api?.close();
	});

	test("robots.txt allows everything and names the index", async () => {
		const robots = await discover.get("/robots.txt");
		assert.equal(
			await robots.text(),
			`User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`,
		);
	});

	test("an index of well-formed children; every listed page answers 200 and is indexable", async () => {
		const children = await allSitemaps(discover);
		assert.deepEqual(Object.keys(children), [
			"/sitemaps/static.xml",
			"/sitemaps/styles.xml",
			"/sitemaps/locations.xml",
			"/sitemaps/studios.xml",
			"/sitemaps/artists.xml",
			"/sitemaps/tattoos.xml",
		]);
		const at = (path: string) => `${SITE}${path}`;
		// Styles with an artist in the default country (an empty style page is noindex).
		assert.ok(
			children["/sitemaps/styles.xml"]?.includes(at("/styles/blackwork")),
		);
		assert.deepEqual(children["/sitemaps/locations.xml"], [
			at("/locations/nepal"),
			at("/locations/nepal/pokhara"),
			at("/locations/nepal/kathmandu"),
			at("/locations/nepal/lalitpur"),
		]);
		assert.equal(children["/sitemaps/studios.xml"]?.length, 20);
		const artists = children["/sitemaps/artists.xml"] ?? [];
		assert.ok(artists.includes(at("/studios/stub-studio-1/artists/crew-1-a")));
		assert.ok(artists.includes(at("/artists/stub-solo-3")));
		assert.ok(artists.includes(at("/studios/stub-studio-5/artists/maya")));
		assert.ok(artists.includes(at("/studios/stub-studio-6/artists/maya")));
		const tattoos = children["/sitemaps/tattoos.xml"] ?? [];
		assert.ok(tattoos.includes(at(`/tattoos/${uuid(3, 0)}`)));
		const all = Object.values(children).flat();
		assert.equal(new Set(all).size, all.length, "no URL twice");
		for (const url of all) assert.ok(url.startsWith(`${SITE}/`), url);
		// Every page but a sample of the photos: 200, no robots tag, self-canonical.
		const sample = [
			...all.filter((url) => !url.includes("/tattoos/")),
			...tattoos.slice(0, 5),
		];
		for (const url of sample) {
			const path = url.slice(SITE.length);
			const response = await discover.get(path, { redirect: "manual" });
			assert.equal(response.status, 200, path);
			assert.equal(response.headers.get("x-robots-tag"), null, path);
			const tags = head(await response.text());
			assert.deepEqual(tags.robots, [], path);
			assert.deepEqual(tags.canonicals, [url], path);
		}
	});

	test("paged children: every row once, each page at most one API page, stable `after` addresses", async () => {
		const full = (await allSitemaps(discover))["/sitemaps/tattoos.xml"] ?? [];
		api.scenario.sitemapPage = 7;
		const children = await allSitemaps(discover);
		const pages = Object.entries(children).filter(([path]) =>
			path.startsWith("/sitemaps/tattoos.xml"),
		);
		assert.ok(pages.length > 2);
		assert.match(
			pages[1]?.[0] ?? "",
			/^\/sitemaps\/tattoos\.xml\?after=[0-9a-f-]{36}$/,
		);
		for (const [, urls] of pages) assert.ok(urls.length <= 7);
		assert.deepEqual(
			pages.flatMap(([, urls]) => urls),
			full,
		);
		// A page address that isn't one: 404, never an empty 200 by accident.
		for (const path of [
			"/sitemaps/static.xml?after=00000000-0000-4000-8000-000000000000",
			"/sitemaps/tattoos.xml?after=nope",
			"/sitemaps/nothing.xml",
		])
			assert.equal((await discover.get(path)).status, 404, path);
	});

	test("eligibility: what the API no longer shows leaves every sitemap (and its page 404s)", async () => {
		api.scenario.hidden.add("stub-studio-2");
		api.scenario.hidden.add("stub-studio-1/crew-1-a");
		api.scenario.hidden.add("stub-solo-3");
		api.scenario.hidden.add(uuid(3, 0));
		const all = Object.values(await allSitemaps(discover)).flat();
		for (const path of [
			"/studios/stub-studio-2",
			"/studios/stub-studio-2/artists/stub-artist-2",
			"/studios/stub-studio-1/artists/crew-1-a",
			"/artists/stub-solo-3",
			`/tattoos/${uuid(3, 0)}`,
		]) {
			assert.ok(!all.includes(`${SITE}${path}`), path);
			assert.equal((await discover.get(path)).status, 404, path);
		}
		assert.ok(all.includes(`${SITE}/studios/stub-studio-1`));
	});

	test("an API failure is a 503 with Retry-After, never a partial sitemap", async () => {
		api.scenario.fail.add("sitemap-tattoos");
		const index = await discover.get("/sitemap.xml");
		assert.equal(index.status, 503);
		assert.equal(index.headers.get("retry-after"), "300");
		assert.equal(index.headers.get("cache-control"), "no-store");
		assert.equal((await discover.get("/sitemaps/tattoos.xml")).status, 503);
		assert.equal((await discover.get("/sitemaps/studios.xml")).status, 200);
	});
});

describe("D10 thin markets, country variants and the production origin", {
	skip,
}, () => {
	let api: StubApi;
	let discover: Discover;
	let production: Discover;
	before(async () => {
		// 3 rows: all Nepal's; India, a market here, has nothing listed.
		api = await stubApi(3);
		discover = await startDiscover(api.url, {
			DISCOVER_INDEXING: "on",
			DISCOVER_MARKETS: "NP,IN",
		});
		production = await startDiscover(api.url, {
			DISCOVER_INDEXING: "on",
			DISCOVER_URL: "https://tattoodrip.app",
			APP_URL: "https://app.tattoodrip.app",
		});
	});
	after(() => {
		discover?.child.kill();
		production?.child.kill();
		api?.close();
	});

	test("an empty market is a 200, noindex, follow and out of the sitemap; a populated one is indexable", async () => {
		const india = await discover.get("/locations/india");
		assert.equal(india.status, 200);
		assert.equal(india.headers.get("x-robots-tag"), "noindex, follow");
		const page = await india.text();
		assert.match(page, /No studios or artists are listed in India yet/);
		assert.deepEqual(head(page).titles, [
			"Tattoo studios and artists in India | Tattoo Drip",
		]);
		const nepal = await discover.get("/locations/nepal");
		assert.equal(nepal.headers.get("x-robots-tag"), null);
		const locations = parseXml(
			await (await discover.get("/sitemaps/locations.xml")).text(),
		).locs;
		assert.ok(locations.includes(`${SITE}/locations/nepal`));
		assert.ok(!locations.some((url) => url.includes("/locations/india")));
	});

	test("location pages are self-canonical whatever the visitor's country; a ?country= variant points to the bare path", async () => {
		for (const init of [{}, { headers: { cookie: "td_country=IN" } }]) {
			const response = await discover.get("/locations/nepal/kathmandu", init);
			assert.equal(response.headers.get("x-robots-tag"), null);
			assert.deepEqual(head(await response.text()).canonicals, [
				`${SITE}/locations/nepal/kathmandu`,
			]);
		}
		const variant = await discover.get("/styles/blackwork?country=IN");
		assert.equal(variant.headers.get("x-robots-tag"), "noindex, follow");
		assert.deepEqual(head(await variant.text()).canonicals, [
			`${SITE}/styles/blackwork`,
		]);
		// An empty filtered directory: a 200, noindex.
		const empty = await discover.get("/explore/studios?q=zzzz");
		assert.equal(empty.status, 200);
		assert.equal(empty.headers.get("x-robots-tag"), "noindex, follow");
	});

	test("on the production origin every canonical, social and structured URL is https://tattoodrip.app, never the request's host", async () => {
		for (const path of [
			"/",
			"/studios/stub-studio-1",
			`/tattoos/${uuid(3, 0)}`,
		]) {
			const page = await (await production.get(path)).text();
			const tags = head(page);
			assert.ok(
				tags.canonicals[0]?.startsWith("https://tattoodrip.app/"),
				path,
			);
			assert.ok(
				tags.og["og:url"]?.[0]?.startsWith("https://tattoodrip.app/"),
				path,
			);
			assert.doesNotMatch(JSON.stringify(jsonLd(page)), /localhost/, path);
			assert.doesNotMatch(tags.canonicals[0] ?? "", /localhost/);
		}
		assert.deepEqual(
			metas(await (await production.get("/")).text(), "og:image"),
			["https://tattoodrip.app/brand/tattoo-drip-512.png"],
		);
		const locs = Object.values(await allSitemaps(production)).flat();
		assert.ok(locs.length > 10);
		for (const url of locs)
			assert.ok(url.startsWith("https://tattoodrip.app/"), url);
		assert.match(
			await (await production.get("/robots.txt")).text(),
			/Sitemap: https:\/\/tattoodrip\.app\/sitemap\.xml/,
		);
	});
});

describe("D10 with indexing off", { skip }, () => {
	let api: StubApi;
	let discover: Discover;
	before(async () => {
		api = await stubApi(3);
		discover = await startDiscover(api.url);
	});
	after(() => {
		discover?.child.kill();
		api?.close();
	});

	test("no sitemap at all, no JSON-LD, noindex, nofollow everywhere; nothing read for a sitemap", async () => {
		for (const path of [
			"/sitemap.xml",
			"/sitemaps/static.xml",
			"/sitemaps/studios.xml",
			"/sitemaps/tattoos.xml?after=00000000-0000-4000-8000-000000000000",
		])
			assert.equal((await discover.get(path)).status, 404, path);
		assert.ok(!api.requests.some((url) => url.includes("/sitemap/")));
		for (const path of [
			"/",
			"/studios/stub-studio-1",
			`/tattoos/${uuid(3, 0)}`,
		]) {
			const response = await discover.get(path);
			assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
			const page = await response.text();
			assert.deepEqual(head(page).robots, ["noindex, nofollow"]);
			assert.deepEqual(jsonLd(page), [], path);
		}
	});
});

// The unreachable-API variant of the index (no stub at all).
describe("D10 sitemaps, API unreachable", { skip }, () => {
	let discover: Discover;
	before(async () => {
		discover = await startDiscover(`http://localhost:${await freePort()}`, {
			DISCOVER_INDEXING: "on",
		});
	});
	after(() => discover?.child.kill());

	test("the index is a 503; robots.txt still answers", async () => {
		assert.equal((await discover.get("/sitemap.xml")).status, 503);
		assert.equal((await discover.get("/robots.txt")).status, 200);
	});
});
