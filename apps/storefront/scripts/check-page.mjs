#!/usr/bin/env node
// Runs the built storefront against a stand-in API with a canary
// STOREFRONT_SERVER_KEY, and checks what a visitor and the log can see
// (TAT-23, spec ruling 8; the studio page since TAT-48): the page carries the
// studio's name, the API's origin and its own origin but never the key, the
// API got one keyed lookup and one keyed artists read per page, each with
// the visitor's address (X-Visitor-IP, TAT-38), a failed
// read is an error page inside the document (never a not-found, never
// cached) and a failed lookup is a 503. The deposit page (TAT-65b) is its
// shell only: one lookup, no-store, no Referer, noindex. Run `pnpm build` first, then
// `pnpm check:page`. It opens two local ports (picked for it) and takes about
// ten seconds, so CI doesn't run it: run it before a release (TAT-13).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const SERVER = join(root, ".output/server/index.mjs");
const CANARY = "canary-key-0123456789abcdefghijklmnopqrstuv";
// The visitor the stand-in API must receive on every keyed call (TAT-38):
// sent as X-Forwarded-For, as Vercel's edge does.
const VISITOR = "203.0.113.7";
// Cloudflare's always-pass test site key: public by design, so the page
// must carry it (production refuses to start without one, TAT-57).
const SITE_KEY = "1x00000000000000000000AA";
const API_DETAIL = "api-internal-detail-must-not-leak";
const SLUG = "canary-ink";
const STUDIO_NAME = "Canary Ink <Studio>";
const STUDIO = {
	slug: SLUG,
	name: STUDIO_NAME,
	type: "studio",
	intro: "Fine line.\nWalk-ins on Sundays.",
	timezone: "Asia/Kathmandu",
	contact: { phone: "+9779812345678", email: null, address: null },
	socialLinks: [],
	acceptingInquiries: true,
};
const ARTISTS = [
	{
		id: "0199f000-0000-7000-8000-000000000048",
		slug: "sita",
		name: "Sita Rai",
		bio: null,
		photo: null,
		acceptingInquiries: true,
		closedMessage: null,
		styles: [],
		socialLinks: [],
	},
];

if (!existsSync(SERVER)) {
	console.error("There is no build to run. Run pnpm build first.");
	process.exit(1);
}

const freePort = () =>
	new Promise((done, reject) => {
		const server = net.createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => done(port));
		});
	});

// The stand-in API: answers the studio lookup and the artists read as `mode`
// says ("artists-5xx" fails only the artists read), and keeps a log.
let mode = "ok";
const apiLog = [];
const api = http.createServer((request, response) => {
	apiLog.push({
		url: request.url,
		authorization: request.headers.authorization ?? null,
		cookie: request.headers.cookie ?? null,
		visitor: request.headers["x-visitor-ip"] ?? null,
	});
	const send = (status, body) => {
		response.writeHead(status, { "content-type": "application/json" });
		response.end(JSON.stringify(body));
	};
	if (mode === "hang") return;
	if (mode === "5xx") {
		return send(500, { error: { code: "internal", message: API_DETAIL } });
	}
	if (mode === "ok" || mode === "artists-5xx") {
		if (request.url === `/api/v1/tenants/${SLUG}`) {
			return send(200, { data: STUDIO });
		}
		if (request.url === `/api/v1/tenants/${SLUG}/artists`) {
			return mode === "ok"
				? send(200, { data: ARTISTS })
				: send(500, { error: { code: "internal", message: API_DETAIL } });
		}
	}
	return send(404, { error: { code: "not_found", message: "Not found." } });
});

const apiPort = await freePort();
const storefrontPort = await freePort();
await new Promise((done) => api.listen(apiPort, "127.0.0.1", done));

let output = "";
const child = spawn(process.execPath, [SERVER], {
	cwd: root,
	env: {
		PATH: process.env.PATH,
		NODE_ENV: "production",
		PORT: String(storefrontPort),
		API_URL: `http://localhost:${apiPort}`,
		STOREFRONT_URL: `http://{tenant}.localhost:${storefrontPort}`,
		STOREFRONT_SERVER_KEY: CANARY,
		TURNSTILE_SITE_KEY: SITE_KEY,
	},
});
child.stdout.on("data", (chunk) => {
	output += chunk;
});
child.stderr.on("data", (chunk) => {
	output += chunk;
});

function get(path = "/") {
	return new Promise((done, reject) => {
		http
			.get(
				{
					host: "127.0.0.1",
					port: storefrontPort,
					path,
					headers: {
						host: `${SLUG}.localhost:${storefrontPort}`,
						"x-forwarded-for": VISITOR,
					},
				},
				(response) => {
					let body = "";
					response.setEncoding("utf8");
					response.on("data", (chunk) => {
						body += chunk;
					});
					response.on("end", () =>
						done({
							status: response.statusCode,
							headers: JSON.stringify(response.headers),
							cacheControl: response.headers["cache-control"],
							body,
						}),
					);
				},
			)
			.on("error", reject);
	});
}

async function waitUntilListening() {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null)
			throw new Error(`The server exited:\n${output}`);
		if (/Listening on/.test(output)) return;
		await new Promise((done) => setTimeout(done, 100));
	}
	throw new Error(`The server did not start in 20 s:\n${output}`);
}

const problems = [];
const expect = (ok, message) => {
	if (!ok) problems.push(message);
};

try {
	await waitUntilListening();

	mode = "ok";
	let page = await get();
	expect(page.status === 200, `A studio page is ${page.status}, not 200.`);
	expect(
		page.body.includes("<title>Canary Ink &lt;Studio&gt;</title>"),
		"The page's <title> is not the studio's name, escaped.",
	);
	expect(
		new RegExp(`apiUrl:"http://localhost:${apiPort}",tenant:"${SLUG}"`).test(
			page.body,
		),
		"The page does not carry the API's origin and the studio's slug.",
	);
	expect(
		page.body.includes(`challengeSiteKey:"${SITE_KEY}"`),
		"The page does not carry the public Turnstile site key.",
	);
	expect(
		page.body.includes(
			`rel="canonical" href="http://${SLUG}.localhost:${storefrontPort}/"`,
		) &&
			page.body.includes(`origin:"http://${SLUG}.localhost:${storefrontPort}"`),
		"The page does not carry its own origin from STOREFRONT_URL (canonical link and router state).",
	);
	expect(
		page.cacheControl ===
			"public, max-age=0, s-maxage=60, stale-while-revalidate=600",
		`A studio page's Cache-Control is "${page.cacheControl}".`,
	);
	expect(
		page.body.includes("application/ld+json") &&
			!page.body.includes("<Studio>") &&
			page.body.includes("\\u003cStudio\\u003e"),
		"The JSON-LD is missing, or the studio's name reaches the page unescaped.",
	);
	expect(
		page.body.includes("Sita Rai") &&
			page.body.includes("https://wa.me/9779812345678"),
		"The page does not show the artist and the studio's WhatsApp link.",
	);
	expect(
		!page.body.includes(CANARY) && !page.headers.includes(CANARY),
		"THE SERVER KEY IS IN THE PAGE OR ITS HEADERS.",
	);
	expect(
		apiLog.length === 2 &&
			apiLog[0].url === `/api/v1/tenants/${SLUG}` &&
			apiLog[1].url === `/api/v1/tenants/${SLUG}/artists` &&
			apiLog.every(
				(call) =>
					call.authorization === `Bearer ${CANARY}` &&
					call.visitor === VISITOR &&
					call.cookie === null,
			),
		`The page made ${apiLog.length} API calls instead of one keyed, cookie-less lookup and one artists read, each carrying the visitor's address.`,
	);

	// An artist's page asks the API once more for the same list, never for the artist.
	apiLog.length = 0;
	page = await get("/artists/sita");
	expect(
		page.status === 200 &&
			page.body.includes(
				"<title>Sita Rai at Canary Ink &lt;Studio&gt;</title>",
			) &&
			page.body.includes(
				`href="http://${SLUG}.localhost:${storefrontPort}/artists/sita"`,
			),
		"An artist's page is not 200 with its own title and canonical link.",
	);
	expect(
		apiLog.map((call) => call.url).join(",") ===
			`/api/v1/tenants/${SLUG},/api/v1/tenants/${SLUG}/artists`,
		"An artist's page asked the API for more than the lookup and the list.",
	);

	// The deposit page (TAT-65b): the server renders its shell from the cached
	// lookup alone. The token is in the fragment, so the server never sees one
	// and asks the API for nothing else. Never stored, never indexed, no Referer.
	apiLog.length = 0;
	page = await get("/deposit");
	expect(
		page.status === 200 &&
			page.body.includes(
				"<title>Pay your deposit · Canary Ink &lt;Studio&gt;</title>",
			),
		`/deposit is ${page.status}, or lacks its own title.`,
	);
	expect(
		page.cacheControl === "no-store",
		`/deposit's Cache-Control is "${page.cacheControl}", not no-store.`,
	);
	expect(
		page.headers.includes('"referrer-policy":"no-referrer"') &&
			page.headers.includes('"x-robots-tag":"noindex, nofollow"'),
		"/deposit does not send Referrer-Policy: no-referrer and X-Robots-Tag: noindex, nofollow.",
	);
	expect(
		/<meta name="robots" content="noindex, nofollow"\/?>/.test(page.body) &&
			/<meta name="referrer" content="no-referrer"\/?>/.test(page.body),
		"/deposit lacks its robots or referrer meta.",
	);
	expect(
		page.body.includes('aria-busy="true"') &&
			page.body.includes("https://wa.me/9779812345678") &&
			!page.body.includes("/deposits/"),
		"/deposit does not render its loading shell with the studio's WhatsApp link, or names the deposit API.",
	);
	expect(
		apiLog.length === 1 && apiLog[0].url === `/api/v1/tenants/${SLUG}`,
		`/deposit asked the API for ${apiLog.map((call) => call.url).join(", ")} instead of the lookup alone.`,
	);

	// Unknown, hidden or malformed artists and unknown paths are the same not-found.
	for (const path of ["/artists/nobody", "/artists/Sita", "/flash"]) {
		apiLog.length = 0;
		page = await get(path);
		expect(page.status === 404, `${path} is ${page.status}, not 404.`);
		// A matched route answers its own header; an unmatched path gets none of ours.
		const wantedCache =
			path === "/flash" ? undefined : "public, max-age=0, s-maxage=60";
		expect(
			page.cacheControl === wantedCache,
			`${path}: Cache-Control is "${page.cacheControl}".`,
		);
		expect(
			page.body.includes("Page not found") && page.body.includes("<html"),
			`${path}: the not-found page is missing or has no document around it.`,
		);
		if (path !== "/artists/nobody") {
			expect(
				apiLog.every((call) => !call.url.endsWith("/artists")),
				`${path} asked the API for the artists list.`,
			);
		}
	}

	// The studio is known but the artists read fails: an error page inside the
	// document, never a not-found, never stored. (The router's state carries the
	// failed match's error message, which is the API's public envelope text, so
	// only the key is checked here, not that text.)
	mode = "artists-5xx";
	page = await get();
	expect(
		page.status === 500 && page.cacheControl === "no-store",
		`A failed artists read is ${page.status} with Cache-Control "${page.cacheControl}", not 500 and no-store.`,
	);
	expect(
		page.body.includes("<html") &&
			page.body.includes("This page can&#x27;t load right now") &&
			!page.body.includes("Page not found"),
		"A failed artists read is not an error page inside the document.",
	);
	expect(
		!page.body.includes(CANARY) && !page.headers.includes(CANARY),
		"A failed artists read shows the server key.",
	);

	for (const [name, wanted] of [
		["5xx", 503],
		["hang", 503],
		["404", 404],
	]) {
		mode = name;
		page = await get();
		expect(
			page.status === wanted,
			`API ${name}: ${page.status}, not ${wanted}.`,
		);
		expect(
			!page.body.includes(CANARY) && !page.body.includes(API_DETAIL),
			`API ${name}: the page shows the key or the API's error message.`,
		);
	}

	expect(
		/Studio lookup failed/.test(output),
		"An API failure left no log line.",
	);
	expect(
		!output.includes(CANARY) && !output.includes(API_DETAIL),
		"THE LOG HOLDS THE SERVER KEY OR THE API'S ERROR MESSAGE.",
	);
} catch (error) {
	problems.push(String(error?.message ?? error));
} finally {
	child.kill();
	api.close();
	api.closeAllConnections();
}

if (problems.length > 0) {
	console.error(
		`Page check failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`,
	);
	process.exit(1);
}
console.log(
	"Page check passed: the key is in no page, header or log line; one keyed lookup and one artists read per page, each carrying the visitor's address; a failed read is an uncached error page, a failed lookup a 503; the deposit page is an uncached, unindexed shell from the lookup alone; the public site key is in the page.",
);
