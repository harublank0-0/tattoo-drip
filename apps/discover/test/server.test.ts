import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { after, before, describe, test } from "node:test";

/**
 * The built server, started as production starts it (D05): it renders the
 * shell, its head and its indexing rules. Needs `pnpm build` first (CI
 * builds before testing); skipped without a build. The API is not running:
 * no page here reads from it.
 */
const ENTRY = new URL("../.output/server/index.mjs", import.meta.url);
const built = existsSync(ENTRY);

const ENV = {
	API_URL: "http://localhost:3999",
	DISCOVER_URL: "http://localhost:3100",
	APP_URL: "http://app.localhost:3333",
};

async function start(
	port: number,
	extra: Record<string, string> = {},
): Promise<ChildProcess> {
	const child = spawn(process.execPath, [ENTRY.pathname], {
		env: {
			...process.env,
			...ENV,
			...extra,
			PORT: String(port),
			NODE_ENV: "production",
		},
		stdio: "ignore",
	});
	for (let i = 0; i < 50; i++) {
		try {
			await fetch(`http://localhost:${port}/robots.txt`);
			return child;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	child.kill();
	throw new Error("The built server did not start.");
}

describe("the built Discover server, indexing off", {
	skip: !built && "no build (run pnpm build)",
}, () => {
	let server: ChildProcess | undefined;
	const port = 3291;
	const get = (path: string) => fetch(`http://localhost:${port}${path}`);
	before(async () => {
		server = await start(port);
	});
	after(() => server?.kill());

	test("the root renders the shared shell, server-side, with safe defaults", async () => {
		const response = await get("/");
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
		assert.match(html, /<header[^>]*>/);
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
		assert.match(
			html,
			/<search[^>]*><form[^>]*action="\/explore\/studios" method="get"/,
		);
		// Nothing secret or server-only reaches the page.
		assert.doesNotMatch(html, /API_URL|process\.env/);
	});

	test("every page shares the shell; a page sets its own title and stays noindex", async () => {
		const html = await (await get("/pricing")).text();
		assert.match(html, /<title>Pricing \| Tattoo Drip<\/title>/);
		assert.equal(html.match(/<meta name="robots"/g)?.length, 1);
		assert.equal(html.match(/<link rel="canonical"/g)?.length, 1);
		assert.match(
			html,
			/<link rel="canonical" href="http:\/\/localhost:3100\/pricing"\/>/,
		);
		assert.match(html, /<footer class="night">/);
		assert.match(html, /role="note"/);
	});

	test("robots.txt disallows everything, there is no sitemap, and an unknown page is a 404", async () => {
		assert.equal(
			await (await get("/robots.txt")).text(),
			"User-agent: *\nDisallow: /\n",
		);
		assert.equal((await get("/sitemap.xml")).status, 404);
		const missing = await get("/no-such-page");
		assert.equal(missing.status, 404);
		assert.match(await missing.text(), /Nothing here/);
	});
});

describe("the built Discover server, indexing on", {
	skip: !built && "no build (run pnpm build)",
}, () => {
	let server: ChildProcess | undefined;
	const port = 3292;
	const get = (path: string) => fetch(`http://localhost:${port}${path}`);
	before(async () => {
		server = await start(port, { DISCOVER_INDEXING: "on" });
	});
	after(() => server?.kill());

	test("finished pages may be indexed; unfinished ones still say noindex", async () => {
		const home = await get("/");
		assert.equal(home.headers.get("x-robots-tag"), null);
		assert.doesNotMatch(await home.text(), /<meta name="robots"/);
		assert.match(
			await (await get("/pricing")).text(),
			/<meta name="robots" content="noindex, nofollow"\/>/,
		);
		assert.match(
			await (await get("/robots.txt")).text(),
			/Sitemap: http:\/\/localhost:3100\/sitemap\.xml/,
		);
		const sitemap = await get("/sitemap.xml");
		assert.equal(sitemap.status, 200);
		assert.match(await sitemap.text(), /<loc>http:\/\/localhost:3100\/<\/loc>/);
	});
});
