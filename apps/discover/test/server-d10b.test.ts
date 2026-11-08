import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { SECURITY_HEADERS } from "../src/lib/headers.ts";
import { skip, startDiscover } from "./built-server.ts";
import { type StubApi, stubApi } from "./stub-api.ts";

/**
 * D10 phase B on the built server: security headers on every kind of
 * response, cache lifetimes (pages, hashed assets, brand files), static
 * files served pre-compressed, the directories' lead image, the page
 * structure every route type shares (one h1, the landmarks, the skip link
 * first), and error pages that never show a stack or the API's message.
 */

type Discover = Awaited<ReturnType<typeof startDiscover>>;

const uuid = (kind: number, index: number) =>
	`00000000-0000-4000-8000-${String(kind).padStart(4, "0")}${String(index).padStart(8, "0")}`;

function assertSecurityHeaders(response: Response, path: string) {
	for (const [name, value] of Object.entries(SECURITY_HEADERS))
		assert.equal(response.headers.get(name), value, `${name} on ${path}`);
}

const PAGES = [
	"/",
	"/explore/studios",
	"/explore/artists",
	"/tattoos",
	`/tattoos/${uuid(3, 0)}`,
	"/studios/stub-studio-1",
	"/studios/stub-studio-0/artists/stub-artist-0",
	"/styles/blackwork",
	"/locations/nepal",
	"/for-studios",
	"/pricing",
];

describe("D10 phase B: headers, caching, structure", { skip }, () => {
	let api: StubApi;
	let discover: Discover;
	before(async () => {
		api = await stubApi(20);
		discover = await startDiscover(api.url);
	});
	after(() => {
		discover?.child.kill();
		api?.close();
	});

	test("every response carries the security headers: pages, 404, 301, server routes, static files", async () => {
		const asset = readdirSync(
			new URL("../.output/public/assets", import.meta.url),
		).find((name) => name.endsWith(".js"));
		for (const [path, status, init] of [
			["/", 200],
			["/explore/studios?q=zzzz", 200],
			["/nope", 404],
			["/tattoos/nope", 404],
			["/explore/tattoos", 301],
			// Start answers a protocol-relative path before any middleware.
			["//evil.example/x", 308],
			["/robots.txt", 200],
			["/sitemap.xml", 404],
			["/favicon.svg", 200],
			[`/assets/${asset}`, 200],
			[
				"/preferences/country",
				403,
				{
					method: "POST",
					headers: { "sec-fetch-site": "cross-site" },
					body: new URLSearchParams({ country: "NP" }),
				},
			],
		] as const) {
			const response = await discover.get(path, {
				redirect: "manual",
				...(init as RequestInit | undefined),
			});
			assert.equal(response.status, status, path);
			assertSecurityHeaders(response, path);
			const location = response.headers.get("location");
			if (location)
				assert.equal(
					new URL(location, "http://localhost").hostname,
					"localhost",
					`${path} → ${location}`,
				);
		}
	});

	test("cache lifetimes: pages private, no-store; hashed assets immutable and pre-compressed; brand files a day", async () => {
		for (const path of [...PAGES, "/nope"]) {
			const response = await discover.get(path);
			assert.equal(
				response.headers.get("cache-control"),
				"private, no-store",
				path,
			);
			assert.equal(response.headers.get("vary"), "Cookie", path);
		}
		const assets = readdirSync(
			new URL("../.output/public/assets", import.meta.url),
		);
		const script = assets.find((name) => /^index-.*\.js$/.test(name));
		const style = assets.find((name) => name.endsWith(".css"));
		for (const name of [script, style]) {
			const response = await discover.get(`/assets/${name}`, {
				headers: { "accept-encoding": "br, gzip" },
			});
			assert.equal(
				response.headers.get("cache-control"),
				"public, max-age=31536000, immutable",
			);
			assert.equal(response.headers.get("content-encoding"), "br", name);
			assert.match(response.headers.get("vary") ?? "", /Accept-Encoding/);
			const gzip = await discover.get(`/assets/${name}`, {
				headers: { "accept-encoding": "gzip" },
			});
			assert.equal(gzip.headers.get("content-encoding"), "gzip", name);
		}
		for (const path of ["/favicon.svg", "/brand/tattoo-drip-512.png"])
			assert.equal(
				(await discover.get(path)).headers.get("cache-control"),
				"public, max-age=86400",
				path,
			);
	});

	test("every route type: one h1, the landmarks, the skip link first, the main target", async () => {
		for (const path of [...PAGES, "/nope", "/explore/studios?q=zzzz"]) {
			const page = await (await discover.get(path)).text();
			const body = page.slice(page.indexOf("<body"));
			assert.equal(body.match(/<h1[\s>]/g)?.length, 1, `one h1 on ${path}`);
			assert.match(body, /<header[\s>]/, path);
			assert.match(body, /<main id="main" tabindex="-1"/, path);
			assert.match(body, /<footer[\s>]/, path);
			const firstFocusable = /<(a|button|input|select|summary)[\s>][^>]*/.exec(
				body,
			)?.[0];
			assert.match(firstFocusable ?? "", /href="#main"/, path);
			assert.match(page, /<html lang="en"/, path);
			// Every image has an alt attribute (empty only for decoration).
			for (const img of body.match(/<img [^>]*>/g) ?? [])
				assert.match(img, / alt="/, `${path}: ${img.slice(0, 80)}`);
		}
	});

	test("a directory's first result loads first; the rest lazily; thumbnails never offer more than the 1280 px copy", async () => {
		for (const path of ["/explore/studios", "/explore/artists"]) {
			const page = await (await discover.get(path)).text();
			const images = page.match(/<img [^>]*>/g) ?? [];
			const first = images.find((img) => img.includes("media.test"));
			assert.match(first ?? "", /fetchPriority="high"/, path);
			assert.match(first ?? "", /loading="eager"/, path);
			assert.equal(
				images.filter((img) => img.includes('fetchPriority="high"')).length,
				1,
				`one high-priority image on ${path}`,
			);
			assert.ok(
				images.some((img) => img.includes('loading="lazy"')),
				`later rows lazy on ${path}`,
			);
			for (const img of images) {
				const widths = [
					...(/srcSet="([^"]*)"/.exec(img)?.[1] ?? "").matchAll(/ (\d+)w/g),
				].map((match) => Number(match[1]));
				assert.ok(
					widths.every((width) => width <= 1280),
					`${path}: ${img.slice(0, 120)}`,
				);
			}
		}
	});

	test("a path that can't be decoded is a 400 at once, never a hung request", async () => {
		for (const path of [
			"/%ff",
			"/tattoos/%E0%A4",
			"/studios/%ff%fe",
			"/%",
			"/assets/%ff",
		]) {
			const response = await discover.get(path, {
				signal: AbortSignal.timeout(3000),
			});
			assert.equal(response.status, 400, path);
			assert.equal(response.headers.get("cache-control"), "no-store", path);
			assertSecurityHeaders(response, path);
		}
		// A valid encoding still works, in the path and the query.
		assert.equal(
			(await discover.get("/tattoos?q=%E0%A4%95%E0%A4%BE")).status,
			200,
		);
		assert.equal((await discover.get("/styles/%62lackwork")).status, 200);
	});

	test("hostile search parameters never fail the page or come back unescaped", async () => {
		const evil = [
			"<script>alert(1)</script>",
			'"><img src=x onerror=alert(1)>',
			"x".repeat(5000),
			"%00",
			"__proto__",
			"😀😀",
			"//evil.example",
		];
		for (const path of ["/explore/studios", "/explore/artists", "/tattoos"])
			for (const key of [
				"q",
				"country",
				"city",
				"style",
				"cursor",
				"artist",
				"studio",
			])
				for (const value of evil) {
					const url = `${path}?${key}=${encodeURIComponent(value)}`;
					const response = await discover.get(url, { redirect: "manual" });
					assert.ok(response.status < 500, `${response.status} ${url}`);
					const location = response.headers.get("location");
					if (location) assert.match(location, /^\/(?!\/)/, url);
					const page = await response.text();
					assert.doesNotMatch(
						page,
						/<script>alert\(1\)|<img src=x onerror/,
						url,
					);
				}
	});
});

describe("D10 phase B: error pages", { skip }, () => {
	let api: StubApi;
	let discover: Discover;
	before(async () => {
		api = await stubApi(20);
		for (const endpoint of [
			"studios",
			"artists",
			"tattoos",
			"studio",
			"tattoo",
		] as const)
			api.scenario.fail.add(endpoint);
		discover = await startDiscover(api.url);
	});
	after(() => {
		discover?.child.kill();
		api?.close();
	});

	test("an API failure is a 500 with the page's own h1, never a stack trace or the API's message", async () => {
		for (const path of [
			"/explore/studios",
			"/explore/artists",
			"/tattoos",
			"/studios/stub-studio-0",
			`/tattoos/${uuid(3, 0)}`,
		]) {
			const response = await discover.get(path);
			assert.equal(response.status, 500, path);
			assertSecurityHeaders(response, path);
			assert.equal(response.headers.get("cache-control"), "private, no-store");
			const page = await response.text();
			assert.match(
				page,
				/<h1[^>]*>Discover is unavailable for a moment<\/h1>/,
				path,
			);
			assert.doesNotMatch(
				page,
				/Stub failure|internal_error|node_modules|\n\s+at \S+ \(|"stack"/,
				path,
			);
		}
	});
});
