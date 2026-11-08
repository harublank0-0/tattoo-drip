#!/usr/bin/env node
// Launch smoke test (Discover D11): read-only HTTP checks of the four public hosts
// after a deploy or the cutover. Run it from any machine with Node 22+; it needs
// nothing from the repo and writes nothing (the one POST sets the visitor's own
// country cookie, which changes no data). It prints names and statuses, never a
// cookie value or a response body.
//
//   node deploy/test/launch-smoke.mjs                       # production, split layout
//   SMOKE_STUDIOS=black-needle,ink-house node deploy/test/launch-smoke.mjs
//
// Settings (environment variables; defaults are production after the cutover):
//   SMOKE_SITE        Discover's origin                 https://tattoodrip.app
//   SMOKE_APP         Studio OS's origin                https://app.tattoodrip.app
//   SMOKE_API         the API's origin                  https://api.tattoodrip.app
//   SMOKE_STOREFRONT  studio pages, {tenant} = slug     https://{tenant}.tattoodrip.page
//   SMOKE_STUDIOS     comma-separated studio slugs whose studio pages must load
//   SMOKE_HIDDEN      comma-separated studio slugs that must NOT be on Discover
//                     (unlisted, taken down or deleted): 404 on Discover and its API
//   SMOKE_INDEXING    "off" (default) or "on": what robots, sitemaps and the
//                     X-Robots-Tag must say (DISCOVER_INDEXING in discover.env)
//   SMOKE_COUNTRY     a market to switch to (one of DISCOVER_MARKETS), default NP
//   SMOKE_CONNECT     host:port to connect to instead of each host's DNS, with the
//                     host still sent as SNI and Host (a rehearsal's edge stand-in);
//                     NODE_EXTRA_CA_CERTS then names the rehearsal's CA
//
// Exit code 0 when every check passed, 1 otherwise. A check that has nothing to
// look at (Discover lists no studio yet) is reported as SKIP, not as a pass.

import http from "node:http";
import https from "node:https";

const env = process.env;
const SITE = origin(env.SMOKE_SITE ?? "https://tattoodrip.app");
const APP = origin(env.SMOKE_APP ?? "https://app.tattoodrip.app");
const API = origin(env.SMOKE_API ?? "https://api.tattoodrip.app");
const STOREFRONT = env.SMOKE_STOREFRONT ?? "https://{tenant}.tattoodrip.page";
const STUDIOS = list(env.SMOKE_STUDIOS);
const HIDDEN = list(env.SMOKE_HIDDEN);
const INDEXING = (env.SMOKE_INDEXING ?? "off").trim().toLowerCase() === "on";
const COUNTRY = (env.SMOKE_COUNTRY ?? "NP").trim().toUpperCase();
const CONNECT = env.SMOKE_CONNECT?.trim() || null;

/** Field names the public API must never return (any depth). */
const PRIVATE_KEYS = [
	"email",
	"phone",
	"password",
	"passwordHash",
	"address",
	"street",
	"postcode",
	"depositPercent",
	"defaultDepositPercent",
	"stripe",
	"bankAccount",
	"clients",
	"inquiries",
	"suspensionNote",
	"discoverySuspensionNote",
	"consentedByUserId",
	"userId",
];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const results = [];

function origin(value) {
	const url = new URL(value);
	return `${url.protocol}//${url.host}`;
}

function list(value) {
	return (value ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

/** One request, never following redirects: status, lower-cased headers, body. */
function request(url, { method = "GET", headers = {}, body } = {}) {
	const target = new URL(url);
	const secure = target.protocol === "https:";
	const [connectHost, connectPort] = CONNECT
		? CONNECT.split(":")
		: [target.hostname, target.port];
	const options = {
		method,
		host: connectHost,
		port: Number(connectPort) || (secure ? 443 : 80),
		path: `${target.pathname}${target.search}`,
		headers: {
			host: target.host,
			"user-agent": "tattoo-drip-launch-smoke/1",
			...headers,
		},
		servername: target.hostname,
		timeout: 15_000,
	};
	return new Promise((resolve, reject) => {
		const req = (secure ? https : http).request(options, (res) => {
			const chunks = [];
			res.on("data", (chunk) => chunks.push(chunk));
			res.on("end", () =>
				resolve({
					status: res.statusCode ?? 0,
					headers: res.headers,
					body: Buffer.concat(chunks).toString("utf8"),
				}),
			);
		});
		req.on("timeout", () => req.destroy(new Error("timed out after 15 s")));
		req.on("error", reject);
		if (body) req.write(body);
		req.end();
	});
}

class Skip extends Error {}

async function check(name, run) {
	try {
		const note = await run();
		results.push({ name, outcome: "PASS", note });
	} catch (error) {
		results.push({
			name,
			outcome: error instanceof Skip ? "SKIP" : "FAIL",
			note: error instanceof Error ? error.message : String(error),
		});
	}
}

function expect(condition, message) {
	if (!condition) throw new Error(message);
}

function expectStatus(response, status, what) {
	const ok = Array.isArray(status)
		? status.includes(response.status)
		: response.status === status;
	expect(ok, `${what}: status ${response.status}, expected ${status}`);
}

function cookies(response) {
	const raw = response.headers["set-cookie"] ?? [];
	return raw.map((line) => {
		const [pair, ...attributes] = line.split(";").map((part) => part.trim());
		return {
			name: pair.split("=", 1)[0],
			attributes: attributes.map((part) => part.toLowerCase()),
		};
	});
}

function privateKeysIn(value, found = new Set()) {
	if (Array.isArray(value)) {
		for (const item of value) privateKeysIn(item, found);
	} else if (value && typeof value === "object") {
		for (const [key, inner] of Object.entries(value)) {
			if (PRIVATE_KEYS.includes(key)) found.add(key);
			privateKeysIn(inner, found);
		}
	}
	return found;
}

function canonicals(html) {
	return [...html.matchAll(/<link[^>]*rel="canonical"[^>]*>/g)].map(
		(match) => /href="([^"]*)"/.exec(match[0])?.[1] ?? "",
	);
}

async function discoverPage(path, what) {
	const response = await request(`${SITE}${path}`);
	expectStatus(response, 200, what);
	expect(
		response.headers["cache-control"] === "private, no-store",
		`${what}: Cache-Control is "${response.headers["cache-control"]}", expected "private, no-store"`,
	);
	expect(
		response.headers["x-content-type-options"] === "nosniff",
		`${what}: no X-Content-Type-Options`,
	);
	expect(
		!/localhost|127\.0\.0\.1|\.local\b/.test(response.body),
		`${what}: the page names a local address`,
	);
	const robots = response.headers["x-robots-tag"];
	if (!INDEXING)
		expect(
			robots === "noindex, nofollow",
			`${what}: X-Robots-Tag is "${robots}" with indexing off`,
		);
	return response;
}

// Discover ------------------------------------------------------------------

let studioPath = null;
let artworkPath = null;

await check(
	"Discover home: 200, private, canonical on the site's origin",
	async () => {
		const home = await discoverPage("/", "home");
		const found = canonicals(home.body);
		expect(found.length === 1, `home has ${found.length} canonical links`);
		expect(found[0].startsWith(`${SITE}/`), `home canonical is ${found[0]}`);
		if (INDEXING)
			expect(
				home.headers["x-robots-tag"] === undefined,
				`home says X-Robots-Tag "${home.headers["x-robots-tag"]}" with indexing on`,
			);
		return found[0];
	},
);

await check("Discover /healthz", async () => {
	const response = await request(`${SITE}/healthz`);
	expectStatus(response, 200, "/healthz");
	expect(response.body.trim() === "ok", "/healthz did not say ok");
});

for (const [path, what] of [
	["/explore/studios", "studio directory"],
	["/explore/artists", "artist directory"],
	["/tattoos", "tattoo gallery"],
	["/for-studios", "for studios"],
]) {
	await check(`Discover ${what} (${path})`, async () => {
		const page = await discoverPage(path, what);
		if (path === "/explore/studios")
			studioPath =
				/href="(\/studios\/[a-z0-9-]+)"/.exec(page.body)?.[1] ?? null;
		if (path === "/tattoos")
			artworkPath =
				new RegExp(`href="(/tattoos/${UUID})"`).exec(page.body)?.[1] ?? null;
	});
}

await check(
	"Discover studio profile (the directory's first studio)",
	async () => {
		if (!studioPath) throw new Skip("the studio directory lists no studio yet");
		await discoverPage(studioPath, studioPath);
		return studioPath;
	},
);

await check("Discover artwork page (the gallery's first photo)", async () => {
	if (!artworkPath) throw new Skip("the gallery lists no photo yet");
	await discoverPage(artworkPath, artworkPath);
	return artworkPath;
});

await check("Discover unknown studio is a 404", async () => {
	const response = await request(`${SITE}/studios/zz-launch-smoke-missing`);
	expectStatus(response, 404, "unknown studio");
});

await check(
	`Discover country switch to ${COUNTRY} (POST /preferences/country)`,
	async () => {
		const response = await request(`${SITE}/preferences/country`, {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				origin: SITE,
				"sec-fetch-site": "same-origin",
			},
			body: new URLSearchParams({ country: COUNTRY, return: "/" }).toString(),
		});
		expectStatus(response, 303, "country switch");
		const cookie = cookies(response).find(
			(entry) => entry.name === "td_country",
		);
		expect(cookie, "no td_country cookie");
		for (const attribute of ["httponly", "samesite=lax", "secure"])
			expect(
				cookie.attributes.includes(attribute),
				`td_country lacks ${attribute}`,
			);
		expect(
			!cookie.attributes.some((part) => part.startsWith("domain=")),
			"td_country has a Domain",
		);
	},
);

await check(`robots.txt with indexing ${INDEXING ? "on" : "off"}`, async () => {
	const response = await request(`${SITE}/robots.txt`);
	expectStatus(response, 200, "robots.txt");
	if (INDEXING)
		expect(
			response.body.includes(`Sitemap: ${SITE}/sitemap.xml`) &&
				!/^Disallow: \/$/m.test(response.body),
			"robots.txt does not allow crawling and name the sitemap",
		);
	else
		expect(
			/^Disallow: \/$/m.test(response.body),
			"robots.txt does not disallow everything",
		);
});

await check(
	`sitemap.xml with indexing ${INDEXING ? "on" : "off"}`,
	async () => {
		const response = await request(`${SITE}/sitemap.xml`);
		if (!INDEXING) {
			expectStatus(response, 404, "sitemap.xml");
			return;
		}
		expectStatus(response, 200, "sitemap.xml");
		const locs = [...response.body.matchAll(/<loc>([^<]*)<\/loc>/g)].map(
			(m) => m[1],
		);
		expect(locs.length > 0, "the sitemap index lists nothing");
		expect(
			locs.every((loc) => loc.startsWith(`${SITE}/`)),
			"a sitemap is not on the site's origin",
		);
		for (const hidden of HIDDEN)
			expect(
				!response.body.includes(`/studios/${hidden}<`),
				`${hidden} is in the index`,
			);
		return `${locs.length} sitemaps`;
	},
);

// Legacy URLs on the apex -----------------------------------------------------

for (const path of [
	"/login",
	"/dashboard",
	"/reset-password/abc",
	"/t/some-studio/settings",
]) {
	await check(`legacy ${path} → 307 to Studio OS`, async () => {
		const response = await request(`${SITE}${path}`);
		expectStatus(response, 307, path);
		expect(
			response.headers.location === `${APP}${path}`,
			`${path} goes to ${response.headers.location}`,
		);
	});
}

await check("legacy /sw.js unregisters the old worker", async () => {
	const response = await request(`${SITE}/sw.js`);
	expectStatus(response, 200, "/sw.js");
	expect(response.body.includes("unregister"), "/sw.js does not unregister");
});

await check("legacy /api on the apex still reaches the API", async () => {
	const response = await request(`${SITE}/api/v1/discover/studios?limit=1`, {
		headers: { accept: "application/json" },
	});
	expectStatus(response, 200, "apex /api");
	expect(Array.isArray(JSON.parse(response.body).data), "no data array");
});

// The API -----------------------------------------------------------------------

await check(
	"API Discover list: 200, CORS for Discover only, no cookie, no private field",
	async () => {
		const response = await request(`${API}/api/v1/discover/studios?limit=24`, {
			headers: { accept: "application/json", origin: SITE },
		});
		expectStatus(response, 200, "discover studios");
		expect(
			response.headers["access-control-allow-origin"] === SITE,
			`allow-origin is "${response.headers["access-control-allow-origin"]}"`,
		);
		expect(!response.headers["set-cookie"], "the API set a cookie");
		const found = privateKeysIn(JSON.parse(response.body));
		expect(
			found.size === 0,
			`private fields in the answer: ${[...found].join(", ")}`,
		);
		const evil = await request(`${API}/api/v1/discover/studios?limit=1`, {
			headers: { accept: "application/json", origin: "https://evil.example" },
		});
		expect(
			evil.headers["access-control-allow-origin"] === undefined,
			"an unlisted origin is allowed",
		);
	},
);

for (const [path, statuses, what] of [
	["/api/v1/discover/studios?limit=100000", [422], "an excessive limit"],
	[
		"/api/v1/discover/studios?cursor=%27%20or%201%3D1--",
		[422],
		"a malformed cursor",
	],
	[
		"/api/v1/discover/studios/zz-launch-smoke-missing",
		[404],
		"an unknown studio",
	],
	["/api/v1/discover/tattoos/not-a-uuid", [404], "an invalid photo id"],
]) {
	await check(`API refuses ${what} without a 5xx`, async () => {
		const response = await request(`${API}${path}`, {
			headers: { accept: "application/json" },
		});
		expectStatus(response, statuses, what);
		expect(
			!/stack|at \w+ \(/i.test(response.body),
			`${what}: the error shows a stack`,
		);
	});
}

await check("API refuses an unexpected method without a 5xx", async () => {
	const response = await request(`${API}/api/v1/discover/studios`, {
		method: "DELETE",
		headers: { accept: "application/json" },
	});
	expect(
		response.status >= 400 && response.status < 500,
		`DELETE: status ${response.status}`,
	);
});

await check(
	"API host serves /api only: /login is a 404 with no cookie",
	async () => {
		const response = await request(`${API}/login`);
		expectStatus(response, 404, "api /login");
		expect(!response.headers["set-cookie"], "the API host set a cookie");
	},
);

for (const hidden of HIDDEN) {
	await check(
		`hidden studio ${hidden} is absent from Discover and its API`,
		async () => {
			expectStatus(
				await request(`${SITE}/studios/${hidden}`),
				404,
				`Discover /studios/${hidden}`,
			);
			expectStatus(
				await request(`${API}/api/v1/discover/studios/${hidden}`, {
					headers: { accept: "application/json" },
				}),
				404,
				`API /discover/studios/${hidden}`,
			);
		},
	);
}

// Studio OS -----------------------------------------------------------------------

await check(
	"Studio OS sign-in page: 200, host-only Secure cookies",
	async () => {
		const response = await request(`${APP}/login`);
		expectStatus(response, 200, "app /login");
		const set = cookies(response);
		expect(set.length > 0, "no cookie set on the sign-in page");
		for (const cookie of set) {
			expect(
				cookie.attributes.includes("secure"),
				`${cookie.name} is not Secure`,
			);
			expect(
				!cookie.attributes.some((part) => part.startsWith("domain=")),
				`${cookie.name} has a Domain (it must stay host-only)`,
			);
		}
		expect(
			set.some((cookie) => cookie.name === "__Host-td-session"),
			"no __Host-td-session cookie",
		);
		return set.map((cookie) => cookie.name).join(", ");
	},
);

await check("Studio OS home redirects a guest to sign in", async () => {
	const response = await request(`${APP}/dashboard`);
	expectStatus(response, [302, 303], "app /dashboard");
	expect(
		(response.headers.location ?? "").endsWith("/login"),
		`a guest goes to ${response.headers.location}`,
	);
});

// Studio pages --------------------------------------------------------------------

for (const slug of STUDIOS) {
	await check(`studio page ${slug}`, async () => {
		const url = STOREFRONT.replace("{tenant}", slug);
		const response = await request(url);
		expectStatus(response, 200, url);
		expect(response.body.includes(API), `the page does not name ${API}`);
	});
}

await check("an unknown studio page is a 404", async () => {
	const response = await request(
		STOREFRONT.replace("{tenant}", "zz-launch-smoke-missing"),
	);
	expectStatus(response, 404, "unknown studio page");
});

// Report --------------------------------------------------------------------------

const width = Math.max(...results.map((result) => result.name.length));
for (const result of results) {
	const note = result.note ? `  (${result.note})` : "";
	console.log(
		`${result.outcome.padEnd(4)}  ${result.name.padEnd(width)}${note}`,
	);
}
const failed = results.filter((result) => result.outcome === "FAIL").length;
const skipped = results.filter((result) => result.outcome === "SKIP").length;
console.log(
	`\n${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`,
);
process.exit(failed > 0 ? 1 : 0);
