import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";

/**
 * The built server, started as production starts it (D05), against a stub of
 * the Discover API: the shell, the head and indexing rules, the one live-data
 * page, malformed input and an unreachable API. Needs `pnpm build` first (CI
 * builds before testing); skipped without a build.
 */
const ENTRY = new URL("../.output/server/index.mjs", import.meta.url);
const built = existsSync(ENTRY);
const skip = !built && "no build (run pnpm build)";

const STUDIO = {
	id: "0b6f8e2c-6a4a-4f1e-9a51-1b0c2d3e4f50",
	slug: "stub-ink",
	name: "Stub Ink <b>Studio</b>",
	type: "studio",
	location: { country: "NP", slug: "pokhara", name: "Pokhara", region: null },
	logo: null,
	cover: null,
	styles: [{ slug: "blackwork", name: "Blackwork" }],
	storefrontUrl: "http://stub-ink.localhost:3000/",
};

async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const { port } = server.address() as AddressInfo;
	await new Promise((resolve) => server.close(resolve));
	return port;
}

/** A stub Discover API: one studio, and every request it got. */
async function stubApi(): Promise<{
	server: Server;
	url: string;
	requests: string[];
}> {
	const requests: string[] = [];
	const server = createServer((request, response) => {
		requests.push(request.url ?? "");
		response.setHeader("Content-Type", "application/json");
		response.end(JSON.stringify({ data: [STUDIO], nextCursor: null }));
	});
	await new Promise<void>((resolve) => server.listen(0, resolve));
	return {
		server,
		url: `http://localhost:${(server.address() as AddressInfo).port}`,
		requests,
	};
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
			DISCOVER_URL: "http://localhost:3100",
			APP_URL: "http://app.localhost:3333",
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

describe("the built Discover server, indexing off", { skip }, () => {
	let api: Awaited<ReturnType<typeof stubApi>>;
	let discover: Awaited<ReturnType<typeof startDiscover>>;
	before(async () => {
		api = await stubApi();
		discover = await startDiscover(api.url);
	});
	after(() => {
		discover?.child.kill();
		api?.server.close();
	});

	test("the root renders the shared shell, server-side, with safe defaults", async () => {
		const response = await discover.get("/");
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
		const html = await response.text();
		assert.match(html, /<html lang="en">/);
		assert.match(
			html,
			/<title>Tattoo Drip: find tattoo studios, artists and work<\/title>/,
		);
		assert.match(html, /<meta name="robots" content="noindex, nofollow"\/>/);
		assert.match(
			html,
			/<link rel="canonical" href="http:\/\/localhost:3100\/"\/>/,
		);
		assert.match(html, /<a class="skip-link" href="#main">/);
		assert.match(html, /<main id="main"/);
		assert.match(html, /<footer class="night">/);
		assert.match(html, /<nav aria-label="Discover"/);
		for (const path of [
			"/explore/studios",
			"/explore/artists",
			"/explore/tattoos",
			"/for-studios",
		]) {
			assert.match(html, new RegExp(`href="${path}"`), path);
		}
		assert.match(html, /href="http:\/\/app\.localhost:3333\/login"/);
		assert.match(html, /href="http:\/\/app\.localhost:3333\/signup"/);
		// The search: a labelled GET form with the API's length rule.
		assert.match(
			html,
			/<search[^>]*><form[^>]*action="\/explore\/studios" method="get"/,
		);
		assert.match(
			html,
			/<label for="[^"]+"[^>]*>Search studios by name<\/label>/,
		);
		assert.match(html, /minLength="2" maxLength="80" required=""/);
		assert.doesNotMatch(html, /API_URL|process\.env/);
		// The shell reads no API data.
		assert.deepEqual(api.requests, []);
	});

	test("/explore/studios reads the API on the server and hands the browser its cache", async () => {
		const response = await discover.get("/explore/studios?q=stub");
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
		const html = await response.text();
		assert.deepEqual(api.requests, ["/api/v1/discover/studios?q=stub"]);
		// API text is text, never markup.
		assert.match(html, /Stub Ink &lt;b&gt;Studio&lt;\/b&gt;/);
		assert.match(html, /href="http:\/\/stub-ink\.localhost:3000\/"/);
		assert.match(html, /Pokhara · Blackwork/);
		// The query is dehydrated into the page, so the browser doesn't ask again.
		assert.match(html, /"discover","studios"/);
		assert.match(
			html,
			/<title>Studios matching &quot;stub&quot; \| Tattoo Drip<\/title>/,
		);
	});

	test("a malformed search never reaches the API", async () => {
		api.requests.length = 0;
		for (const q of ["a", "x".repeat(81), "%20%20"]) {
			const response = await discover.get(`/explore/studios?q=${q}`);
			assert.equal(response.status, 200, q);
		}
		assert.deepEqual(api.requests, Array(3).fill("/api/v1/discover/studios"));
	});

	test("pages share the shell and stay noindex; an unknown page is a titled 404", async () => {
		const pricing = await discover.get("/pricing");
		assert.equal(pricing.headers.get("x-robots-tag"), "noindex, nofollow");
		const html = await pricing.text();
		assert.match(html, /<title>Pricing \| Tattoo Drip<\/title>/);
		assert.equal(html.match(/<meta name="robots"/g)?.length, 1);
		assert.equal(html.match(/<link rel="canonical"/g)?.length, 1);
		assert.match(html, /<footer class="night">/);
		assert.match(html, /role="note"/);

		const missing = await discover.get("/no-such-page");
		assert.equal(missing.status, 404);
		assert.equal(missing.headers.get("x-robots-tag"), "noindex, nofollow");
		const page = await missing.text();
		assert.match(page, /Nothing here/);
		assert.match(page, /<title>Page not found \| Tattoo Drip<\/title>/);
	});

	test("robots.txt disallows everything and there is no sitemap", async () => {
		assert.equal(
			await (await discover.get("/robots.txt")).text(),
			"User-agent: *\nDisallow: /\n",
		);
		assert.equal((await discover.get("/sitemap.xml")).status, 404);
	});
});

describe("the built Discover server, API unreachable", { skip }, () => {
	let discover: Awaited<ReturnType<typeof startDiscover>>;
	before(async () => {
		discover = await startDiscover(`http://localhost:${await freePort()}`);
	});
	after(() => discover?.child.kill());

	test("the shell still renders; a data page says Discover is unavailable, marked for the browser", async () => {
		assert.equal((await discover.get("/")).status, 200);
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
	let api: Awaited<ReturnType<typeof stubApi>>;
	let discover: Awaited<ReturnType<typeof startDiscover>>;
	before(async () => {
		api = await stubApi();
		discover = await startDiscover(api.url, { DISCOVER_INDEXING: "on" });
	});
	after(() => {
		discover?.child.kill();
		api?.server.close();
	});

	test("only listed pages may be indexed; the rest still say noindex", async () => {
		const home = await discover.get("/");
		assert.equal(home.headers.get("x-robots-tag"), null);
		assert.doesNotMatch(await home.text(), /<meta name="robots"/);
		for (const path of ["/pricing", "/explore/studios"]) {
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
		assert.match(await sitemap.text(), /<loc>http:\/\/localhost:3100\/<\/loc>/);
	});
});
