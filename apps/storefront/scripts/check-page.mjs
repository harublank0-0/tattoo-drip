#!/usr/bin/env node
// Runs the built storefront against a stand-in API with a canary
// STOREFRONT_SERVER_KEY, and checks what a visitor and the log can see
// (TAT-23, spec ruling 8; the studio page since TAT-48): the page carries the
// studio's name, the API's origin and its own origin but never the key, shows
// the studio's photos from their own origin (MEDIA_URL, apart from the API's
// as R2's is in production) and none from the API's, the
// API got one keyed lookup and one keyed artists read per page (the studio
// page, an artist's page and /gallery add one gallery read, TAT-126), each with
// the visitor's address (X-Visitor-IP, TAT-38; /request, TAT-127, reads the
// lookup and the list alone), a failed
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
// The photos' own origin (MEDIA_URL), as R2's custom domain is in production:
// another origin than the API's. Nothing listens there; the page only names it.
const MEDIA = "http://127.0.0.1:9";
const LOGO_URL = `${MEDIA}/tenants/t/studio_logo/logo.png`;
const WORK_URL = `${MEDIA}/tenants/t/artist_work_photo/w1.jpg`;
const WORK_COPY_URL = `${MEDIA}/tenants/t/artist_work_photo/w1.640w.jpg`;
// The same kind of photo on the API's own origin, which the page must not show
// once MEDIA_URL names another: a photo is on exactly one origin.
const STRAY_PATH = "/tenants/t/artist_work_photo/stray.jpg";
const STUDIO = {
	slug: SLUG,
	name: STUDIO_NAME,
	type: "studio",
	intro: "Fine line.\nWalk-ins on Sundays.",
	timezone: "Asia/Kathmandu",
	contact: { phone: "+9779812345678", email: null, address: null },
	socialLinks: [],
	acceptingInquiries: true,
	storefront: {
		theme: "stencil-and-ink",
		branding: { logo: { url: LOGO_URL, width: 600, height: 200 } },
	},
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
		workPhotos: [
			{
				url: WORK_URL,
				width: 2048,
				height: 1536,
				alt: null,
				variants: [{ url: WORK_COPY_URL, width: 640 }],
			},
			// apiPort is not known yet: the stand-in puts the API's origin in front.
			{ url: STRAY_PATH, width: 2048, height: 1536, alt: null, variants: [] },
		],
	},
];

// The gallery read (TAT-126) with no photo in it: the stand-in has none.
const EMPTY_WORK = {
	data: [],
	nextCursor: null,
	filters: { styles: [], healed: false },
};

// The flash read with no design in it (TAT-129).
const EMPTY_FLASH = {
	data: [],
	nextCursor: null,
	filters: { artists: [] },
};

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
// says ("artists-5xx" fails only the artists read, "work-5xx" only the gallery
// read), and keeps a log.
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
	if (mode === "ok" || mode === "artists-5xx" || mode === "work-5xx") {
		if (request.url === `/api/v1/tenants/${SLUG}`) {
			return send(200, { data: STUDIO });
		}
		if (request.url === `/api/v1/tenants/${SLUG}/artists`) {
			return mode === "artists-5xx"
				? send(500, { error: { code: "internal", message: API_DETAIL } })
				: send(200, {
						data: JSON.parse(
							JSON.stringify(ARTISTS).replace(
								`"${STRAY_PATH}"`,
								`"http://localhost:${apiPort}${STRAY_PATH}"`,
							),
						),
					});
		}
		// Flash (TAT-129): the list is empty; a design is the API's 404 below.
		if (request.url.startsWith(`/api/v1/tenants/${SLUG}/flash?`)) {
			return send(200, EMPTY_FLASH);
		}
		if (request.url.startsWith(`/api/v1/tenants/${SLUG}/work?`)) {
			if (mode === "work-5xx") {
				return send(500, { error: { code: "internal", message: API_DETAIL } });
			}
			// A cursor the platform would refuse is a 422, as the real API says.
			return request.url.includes("cursor=bogus")
				? send(422, {
						error: {
							code: "validation_failed",
							message: "That is not a cursor from this list.",
							fields: { cursor: ["That is not a cursor from this list."] },
						},
					})
				: send(200, EMPTY_WORK);
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
		MEDIA_URL: MEDIA,
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
		page.body.includes(
			`apiUrl:"http://localhost:${apiPort}",mediaUrl:"${MEDIA}",tenant:"${SLUG}"`,
		),
		"The page does not carry the API's origin, the photos' origin and the studio's slug.",
	);
	// The photos the page shows: every <img>'s src and srcset addresses.
	const shown = [...page.body.matchAll(/<img\b[^>]*>/g)].flatMap(([tag]) =>
		[...tag.matchAll(/\b(?:src|srcSet|srcset)="([^"]*)"/g)].flatMap(
			([, value]) => value.split(",").map((part) => part.trim().split(" ")[0]),
		),
	);
	expect(
		shown.includes(LOGO_URL) &&
			shown.includes(WORK_URL) &&
			shown.includes(WORK_COPY_URL),
		`The page does not show the logo and the work photo (with its copy) from MEDIA_URL; it shows ${shown.join(", ") || "no image"}.`,
	);
	expect(
		!shown.some((url) => url.startsWith(`http://localhost:${apiPort}/`)),
		`The page shows a photo from the API's origin although MEDIA_URL names another: ${shown.join(", ")}.`,
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
	// The studio page asks for the lookup, the artists and the newest 9 photos
	// (Recent work, TAT-126), and shows no Recent work when there are none.
	expect(
		apiLog
			.map((call) => call.url)
			.sort()
			.join(",") ===
			[
				`/api/v1/tenants/${SLUG}`,
				`/api/v1/tenants/${SLUG}/artists`,
				`/api/v1/tenants/${SLUG}/flash?available=true&limit=6`,
				`/api/v1/tenants/${SLUG}/work?limit=9`,
			].join(",") &&
			apiLog.every(
				(call) =>
					call.authorization === `Bearer ${CANARY}` &&
					call.visitor === VISITOR &&
					call.cookie === null,
			),
		`The page made the API calls ${apiLog.map((call) => call.url).join(", ")} instead of one keyed, cookie-less lookup, one artists read, the newest 6 flash designs and the newest 9 photos, each carrying the visitor's address.`,
	);
	expect(
		!page.body.includes("Recent work") && !page.body.includes("All work"),
		"The page shows Recent work, or a link to all work, with no photos.",
	);

	// An artist's page asks the API once more for the same list, never for the
	// artist, and for that artist's newest photos (TAT-126).
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
		apiLog
			.map((call) => call.url)
			.sort()
			.join(",") ===
			[
				`/api/v1/tenants/${SLUG}`,
				`/api/v1/tenants/${SLUG}/artists`,
				`/api/v1/tenants/${SLUG}/flash?artist=sita&limit=12`,
				`/api/v1/tenants/${SLUG}/work?artist=sita&limit=24`,
			].join(","),
		`An artist's page asked the API for ${apiLog.map((call) => call.url).join(", ")} instead of the lookup, the list, the artist's newest 12 flash designs and their newest 24 photos.`,
	);
	expect(
		apiLog.every(
			(call) =>
				call.authorization === `Bearer ${CANARY}` && call.cookie === null,
		),
		"An artist's page made an API call without the key, or with a cookie.",
	);

	// The request page (TAT-127): the form on a page of its own, with the
	// artist from the address. It asks for the lookup and the list alone (no
	// work read), carries the public site key for its form, and answers as every
	// page does.
	apiLog.length = 0;
	page = await get("/book?artist=sita");
	expect(
		page.status === 200 &&
			page.body.includes(
				"<title>Send your idea to Sita Rai at Canary Ink &lt;Studio&gt;</title>",
			) &&
			page.body.includes(
				`href="http://${SLUG}.localhost:${storefrontPort}/book?artist=sita"`,
			),
		`/book?artist=sita is ${page.status}, or lacks its own title and canonical link.`,
	);
	expect(
		page.cacheControl ===
			"public, max-age=0, s-maxage=60, stale-while-revalidate=600",
		`/book's Cache-Control is "${page.cacheControl}".`,
	);
	expect(
		page.body.includes(`challengeSiteKey:"${SITE_KEY}"`) &&
			page.body.includes("your idea for") &&
			!page.body.includes(CANARY),
		"/book does not carry the public Turnstile site key and the artist's form, or shows the server key.",
	);
	expect(
		apiLog
			.map((call) => call.url)
			.sort()
			.join(",") ===
			[`/api/v1/tenants/${SLUG}`, `/api/v1/tenants/${SLUG}/artists`].join(
				",",
			) &&
			apiLog.every(
				(call) =>
					call.authorization === `Bearer ${CANARY}` &&
					call.visitor === VISITOR &&
					call.cookie === null,
			),
		`/book asked the API for ${apiLog.map((call) => call.url).join(", ")} instead of the lookup and the list alone, each keyed, cookie-less and carrying the visitor's address.`,
	);
	// An address that is not what we wrote is still the form, never a not-found.
	// The request page's old address is a permanent redirect with its query (Prompt 6).
	page = await get("/request?artist=sita");
	expect(
		page.status === 301 &&
			JSON.parse(page.headers).location === "/book?artist=sita",
		`/request?artist=sita is ${page.status} to ${JSON.parse(page.headers).location}, not a 301 to /book with the same query.`,
	);

	page = await get("/book?artist=Nobody&fbclid=IwAR0");
	expect(
		page.status === 200 &&
			page.body.includes(
				"<title>Send your idea to Canary Ink &lt;Studio&gt;</title>",
			) &&
			page.body.includes(
				`href="http://${SLUG}.localhost:${storefrontPort}/book"`,
			),
		`/book?artist=Nobody&fbclid=… is ${page.status}, not the general form at /book.`,
	);

	// A flash design the API doesn't know (the stand-in 404s every design): the
	// general form with a note, never a not-found, and the design is read once.
	const FLASH_ID = "0199f000-0000-7000-8000-000000000001";
	apiLog.length = 0;
	page = await get(`/book?flash=${FLASH_ID}&fbclid=IwAR0`);
	expect(
		page.status === 200 &&
			page.body.includes(
				"<title>Send your idea to Canary Ink &lt;Studio&gt;</title>",
			) &&
			page.body.includes("page any more") &&
			!page.body.includes(CANARY),
		`/book?flash=<unknown id> is ${page.status}, or lacks the general form and the note that the design isn't on the page.`,
	);
	expect(
		apiLog
			.map((call) => call.url)
			.sort()
			.join(",") ===
			[
				`/api/v1/tenants/${SLUG}`,
				`/api/v1/tenants/${SLUG}/artists`,
				`/api/v1/tenants/${SLUG}/flash/${FLASH_ID}`,
			].join(","),
		`/book?flash=<id> asked the API for ${apiLog.map((call) => call.url).join(", ")} instead of the lookup, the list and the design.`,
	);
	// A well-formed request for an artist still reads the lookup and the list alone.
	apiLog.length = 0;
	page = await get("/book?artist=sita");
	expect(
		page.status === 200 && apiLog.every((call) => !call.url.includes("/flash")),
		`/book?artist=sita read a flash design (${apiLog.map((call) => call.url).join(", ")}).`,
	);

	// The studio's sitemap and robots.txt (Prompt 8): on its own origin, cached
	// like a page, never a deposit page.
	page = await get("/sitemap.xml");
	expect(
		page.status === 200 &&
			JSON.parse(page.headers)["content-type"]?.startsWith("application/xml") &&
			page.body.includes(
				`<loc>http://${SLUG}.localhost:${storefrontPort}/</loc>`,
			) &&
			!page.body.includes("/deposit") &&
			page.cacheControl ===
				"public, max-age=0, s-maxage=60, stale-while-revalidate=600",
		`/sitemap.xml is ${page.status} (Cache-Control "${page.cacheControl}"), or lacks the studio's own page on its origin.`,
	);
	page = await get("/robots.txt");
	expect(
		page.status === 200 &&
			page.body.includes(
				`Sitemap: http://${SLUG}.localhost:${storefrontPort}/sitemap.xml`,
			),
		`/robots.txt is ${page.status}, or does not name the studio's sitemap.`,
	);

	// The gallery (TAT-126; /gallery since Prompt 5): the lookup, the list and
	// the first page of photos.
	apiLog.length = 0;
	page = await get("/gallery");
	expect(
		page.status === 200 &&
			page.body.includes(
				"<title>All work at Canary Ink &lt;Studio&gt;</title>",
			) &&
			page.body.includes(
				`href="http://${SLUG}.localhost:${storefrontPort}/gallery"`,
			),
		`/gallery is ${page.status}, or lacks its own title and canonical link.`,
	);
	expect(
		page.cacheControl ===
			"public, max-age=0, s-maxage=60, stale-while-revalidate=600",
		`/gallery's Cache-Control is "${page.cacheControl}".`,
	);
	expect(
		page.body.includes("No photos yet.") && !page.body.includes(CANARY),
		"/gallery does not say there are no photos, or shows the server key.",
	);
	expect(
		apiLog
			.map((call) => call.url)
			.sort()
			.join(",") ===
			[
				`/api/v1/tenants/${SLUG}`,
				`/api/v1/tenants/${SLUG}/artists`,
				`/api/v1/tenants/${SLUG}/work?limit=24`,
			].join(","),
		`/gallery asked the API for ${apiLog.map((call) => call.url).join(", ")} instead of the lookup, the list and the first 24 photos.`,
	);

	// Flash (TAT-129): the lookup, the list and the first page of designs.
	apiLog.length = 0;
	page = await get("/flash");
	expect(
		page.status === 200 &&
			page.body.includes("<title>Flash at Canary Ink &lt;Studio&gt;</title>") &&
			page.body.includes(
				`href="http://${SLUG}.localhost:${storefrontPort}/flash"`,
			),
		`/flash is ${page.status}, or lacks its own title and canonical link.`,
	);
	expect(
		page.cacheControl ===
			"public, max-age=0, s-maxage=60, stale-while-revalidate=600",
		`/flash's Cache-Control is "${page.cacheControl}".`,
	);
	expect(
		page.body.includes("No flash designs yet.") && !page.body.includes(CANARY),
		"/flash does not say there are no designs, or shows the server key.",
	);
	expect(
		apiLog
			.map((call) => call.url)
			.sort()
			.join(",") ===
			[
				`/api/v1/tenants/${SLUG}`,
				`/api/v1/tenants/${SLUG}/artists`,
				`/api/v1/tenants/${SLUG}/flash?limit=24`,
			].join(","),
		`/flash asked the API for ${apiLog.map((call) => call.url).join(", ")} instead of the lookup, the list and the first 24 designs.`,
	);
	// A design id that is not a UUID is the not-found with no call but the lookup.
	apiLog.length = 0;
	page = await get("/flash/NOT-A-UUID");
	expect(
		page.status === 404 &&
			page.body.includes("Page not found") &&
			apiLog.every((call) => call.url === `/api/v1/tenants/${SLUG}`),
		`/flash/NOT-A-UUID is ${page.status}, or asked the API for ${apiLog.map((call) => call.url).join(", ")}.`,
	);

	// One tattoo's page (Prompt 5): an id that is not a UUID is the not-found
	// with no call but the lookup.
	apiLog.length = 0;
	page = await get("/gallery/NOT-A-UUID");
	expect(
		page.status === 404 &&
			page.body.includes("Page not found") &&
			apiLog.every((call) => call.url === `/api/v1/tenants/${SLUG}`),
		`/gallery/NOT-A-UUID is ${page.status}, or asked the API for ${apiLog.map((call) => call.url).join(", ")}.`,
	);

	// The gallery's old address is a permanent redirect with its query as it was.
	page = await get("/work?artist=sita&healed=1");
	expect(
		page.status === 301 &&
			JSON.parse(page.headers).location === "/gallery?artist=sita&healed=1",
		`/work?artist=sita&healed=1 is ${page.status} to ${JSON.parse(page.headers).location}, not a 301 to /gallery with the same query.`,
	);

	// The router's own spelling of the address is ours: ?healed=1 is no redirect.
	page = await get("/gallery?artist=sita&healed=1");
	expect(
		page.status === 200,
		`/gallery?artist=sita&healed=1 is ${page.status}, not 200 (the router redirects an address it spells otherwise).`,
	);

	// The router reads the search as plain strings: an artist whose slug looks
	// like JSON (true, null, 1e2, 2025) is no redirect and reaches the API as typed.
	for (const slug of ["true", "false", "null", "1e2", "2025"]) {
		apiLog.length = 0;
		page = await get(`/gallery?artist=${slug}&healed=1`);
		expect(
			page.status === 200,
			`/gallery?artist=${slug}&healed=1 is ${page.status}, not 200 (a redirect, or the router read the slug as JSON).`,
		);
		expect(
			apiLog.some(
				(call) =>
					call.url ===
					`/api/v1/tenants/${SLUG}/work?artist=${slug}&healed=true&limit=24`,
			),
			`/gallery?artist=${slug}&healed=1 asked the API for ${apiLog.map((call) => call.url).join(", ")}, not for artist ${slug} healed.`,
		);
	}
	page = await get("/artists/sita?healed=1");
	expect(
		page.status === 200,
		`/artists/sita?healed=1 is ${page.status}, not 200.`,
	);

	// A cursor the API refuses (a hand-edited link) is the not-found page.
	page = await get("/gallery?cursor=bogus");
	expect(
		page.status === 404 &&
			page.body.includes("Page not found") &&
			page.cacheControl === "public, max-age=0, s-maxage=60",
		`/gallery with a cursor the API refuses is ${page.status} (Cache-Control "${page.cacheControl}"), not the cached 404 page.`,
	);
	page = await get("/artists/sita?cursor=bogus");
	expect(
		page.status === 404 && page.body.includes("Page not found"),
		`An artist's page with a cursor the API refuses is ${page.status}, not the 404 page.`,
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
	for (const path of ["/artists/nobody", "/artists/Sita", "/admin/bookings"]) {
		apiLog.length = 0;
		page = await get(path);
		expect(page.status === 404, `${path} is ${page.status}, not 404.`);
		// A matched route answers its own header; an unmatched path gets none of ours.
		const wantedCache =
			path === "/admin/bookings" ? undefined : "public, max-age=0, s-maxage=60";
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
	// document, never a not-found, never stored. The router's state carries the
	// failed match's error, which is a fixed sentence (PageReadError, Prompt 8),
	// never the API's message; the log says what failed.
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
		!page.body.includes(CANARY) &&
			!page.headers.includes(CANARY) &&
			!page.body.includes(API_DETAIL),
		"A failed artists read shows the server key or the API's error message.",
	);
	expect(
		/Page read failed/.test(output),
		"A failed artists read left no log line.",
	);

	// The photos fail but the studio and the artists do not: the page stands,
	// cacheable as ever and without Recent work, and the log says what failed
	// (without the API's message).
	mode = "work-5xx";
	page = await get();
	expect(
		page.status === 200 &&
			page.cacheControl ===
				"public, max-age=0, s-maxage=60, stale-while-revalidate=600" &&
			page.body.includes("Sita Rai") &&
			!page.body.includes("Recent work"),
		`A failed gallery read is ${page.status} with Cache-Control "${page.cacheControl}", not the studio page without Recent work.`,
	);
	expect(
		/Recent work read failed/.test(output),
		"A failed gallery read left no log line.",
	);
	expect(
		!page.body.includes(CANARY) && !page.body.includes(API_DETAIL),
		"A failed gallery read shows the key or the API's error message.",
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
	"Page check passed: the key is in no page, header or log line; the photos are shown from MEDIA_URL's origin only; one keyed lookup and one artists read per page (the studio page, an artist's page and /gallery add one gallery read, /flash and an artist's page one flash read), each carrying the visitor's address; a failed read is an uncached error page (a failed gallery read only leaves the photos out), a failed lookup a 503; the deposit page is an uncached, unindexed shell from the lookup alone; the public site key is in the page.",
);
