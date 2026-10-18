#!/usr/bin/env node
// Runs the built storefront against a stand-in API with a canary
// STOREFRONT_SERVER_KEY, and checks what a visitor and the log can see
// (TAT-23, spec ruling 8): the page carries the studio's name and the API's
// origin but never the key, the API got one keyed call per page, and an API
// failure is a 503, never a not-found. Run `pnpm build` first, then
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
const API_DETAIL = "api-internal-detail-must-not-leak";
const SLUG = "canary-ink";
const STUDIO_NAME = "Canary Ink <Studio>";

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

// The stand-in API: answers the studio lookup as `mode` says, and keeps a log.
let mode = "ok";
const apiLog = [];
const api = http.createServer((request, response) => {
	apiLog.push({
		url: request.url,
		authorization: request.headers.authorization ?? null,
		cookie: request.headers.cookie ?? null,
	});
	const send = (status, body) => {
		response.writeHead(status, { "content-type": "application/json" });
		response.end(JSON.stringify(body));
	};
	if (mode === "hang") return;
	if (mode === "5xx") {
		return send(500, { error: { code: "internal", message: API_DETAIL } });
	}
	if (mode === "ok" && request.url === `/api/v1/tenants/${SLUG}`) {
		return send(200, { data: { slug: SLUG, name: STUDIO_NAME } });
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
	},
});
child.stdout.on("data", (chunk) => {
	output += chunk;
});
child.stderr.on("data", (chunk) => {
	output += chunk;
});

function get() {
	return new Promise((done, reject) => {
		http
			.get(
				{
					host: "127.0.0.1",
					port: storefrontPort,
					path: "/",
					headers: { host: `${SLUG}.localhost:${storefrontPort}` },
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
		!page.body.includes(CANARY) && !page.headers.includes(CANARY),
		"THE SERVER KEY IS IN THE PAGE OR ITS HEADERS.",
	);
	expect(
		apiLog.length === 1 &&
			apiLog[0].url === `/api/v1/tenants/${SLUG}` &&
			apiLog[0].authorization === `Bearer ${CANARY}` &&
			apiLog[0].cookie === null,
		`The page made ${apiLog.length} API calls instead of one keyed, cookie-less lookup.`,
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
	"Page check passed: the key is in no page, header or log line; one keyed lookup per page; API failures are 503s.",
);
