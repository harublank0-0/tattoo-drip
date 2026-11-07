import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import { type Endpoint, type StubApi, stubApi } from "./stub-api.ts";

/**
 * The built server, started as production starts it (D05, D06), against a
 * stub of the Discover API serving 0, 3 or 20 studios, artists and photos:
 * the shell, the head and indexing rules, the homepage's sections and
 * their thresholds, failing and hanging reads, the studio filters, the
 * marketing pages. Needs `pnpm build` first (CI builds before testing);
 * skipped without a build.
 */
const ENTRY = new URL("../.output/server/index.mjs", import.meta.url);
const built = existsSync(ENTRY);
const skip = !built && "no build (run pnpm build)";

const APP = "http://app.localhost:3333";
const SITE = "http://localhost:3100";
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

async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const { port } = server.address() as AddressInfo;
	await new Promise((resolve) => server.close(resolve));
	return port;
}

async function startDiscover(
	apiUrl: string,
	extra: Record<string, string> = {},
) {
	const port = await freePort();
	const child: ChildProcess = spawn(process.execPath, [ENTRY.pathname], {
		env: {
			...process.env,
			API_URL: apiUrl,
			DISCOVER_URL: SITE,
			APP_URL: APP,
			...extra,
			PORT: String(port),
			NODE_ENV: "production",
		},
		stdio: "ignore",
	});
	const get = (path: string) => fetch(`http://localhost:${port}${path}`);
	for (let i = 0; i < 50; i++) {
		try {
			await get("/robots.txt");
			return { child, get };
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	child.kill();
	throw new Error("The built server did not start.");
}

/** The sections a homepage rendered, by their headings' ids. */
function sections(html: string): string[] {
	return SECTIONS.filter((id) => html.includes(`id="${id}"`));
}

/** The visible text of a page, roughly: tags and the dehydrated script removed. */
function text(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/g, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ");
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
			"/explore/tattoos",
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
		assert.match(html, /href="http:\/\/stub-studio-1\.localhost:3000\/"/);
		assert.match(
			html,
			/href="http:\/\/stub-studio-0\.localhost:3000\/artists\/stub-artist-0"/,
		);
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
		// Styles and places link to the studio list with their parameters.
		assert.match(html, /href="\/explore\/studios\?style=blackwork"/);
		assert.match(html, /href="\/explore\/studios\?style=fine-line"/);
		assert.match(
			html,
			/href="\/explore\/studios\?country=NP&amp;city=pokhara"/,
		);
		assert.match(
			html,
			/href="\/explore\/studios\?country=IN&amp;city=new-delhi"/,
		);
		assert.match(html, />Nepal</);
		assert.match(html, /href="\/explore\/tattoos"/);
		// Never a Discover page that doesn't exist yet.
		assert.doesNotMatch(
			html,
			/href="\/(tattoos|studios|artists|styles|locations)\//,
		);
		// One request per read, with the homepage's limits; none repeated.
		assert.deepEqual([...api.requests].sort(), [
			"/api/v1/discover/artists?limit=8",
			"/api/v1/discover/locations",
			"/api/v1/discover/studios?limit=8",
			"/api/v1/discover/styles",
			"/api/v1/discover/tattoos?limit=24",
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
		assert.ok(api.requests.includes("/api/v1/discover/studios?q=stub"));
		assert.equal(
			api.requests.filter((url) => url.startsWith("/api/v1/discover/studios"))
				.length,
			1,
		);
		// API text is text, never markup.
		assert.match(html, /Stub Ink &lt;b&gt;Studio&lt;\/b&gt;/);
		assert.match(html, /href="http:\/\/stub-studio-0\.localhost:3000\/"/);
		assert.match(html, /Pokhara · Blackwork/);
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
			if (search.startsWith("country=NPL")) assert.ok(!sent.has("country"));
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
		assert.deepEqual(api.requests, ["/api/v1/discover/artists"]);
		assert.match(html, /Stub Artist 2/);
		assert.match(
			html,
			/href="http:\/\/stub-studio-2\.localhost:3000\/artists\/stub-artist-2"/,
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
			"/explore/tattoos",
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

	test("only the home and Studio OS pages may be indexed; the rest still say noindex", async () => {
		for (const path of ["/", "/for-studios"]) {
			const page = await discover.get(path);
			assert.equal(page.headers.get("x-robots-tag"), null, path);
			assert.doesNotMatch(await page.text(), /<meta name="robots"/, path);
		}
		for (const path of [
			"/pricing",
			"/explore/studios",
			"/explore/artists",
			"/explore/tattoos",
		]) {
			assert.match(
				await (await discover.get(path)).text(),
				/<meta name="robots" content="noindex, nofollow"\/>/,
				path,
			);
		}
		assert.match(
			await (await discover.get("/robots.txt")).text(),
			/Sitemap: http:\/\/localhost:3100\/sitemap\.xml/,
		);
		const sitemap = await discover.get("/sitemap.xml");
		assert.equal(sitemap.status, 200);
		const locs = [
			...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g),
		].map((match) => match[1]);
		assert.deepEqual(locs, [`${SITE}/`, `${SITE}/for-studios`]);
	});
});
