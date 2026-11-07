// Runs inside a client container on the tattoo_drip subnet and talks to nginx
// at its fixed address, like cloudflared does in production.
//
//   node check.mjs trusted [layout]    from 172.30.42.20 (cloudflared's address)
//   node check.mjs outsider [layout]   from 172.30.42.99 (anything else)
//
// layout is the file nginx was started with: nginx.conf (live: dashboard and
// API on tattoodrip.app, the default) or nginx.split.conf (D11: app., api.,
// Discover on the apex, legacy redirects).
//
// Prints one line per check and exits 1 when any failed. run.sh starts it from
// each client and then checks nginx's access log.
import http from "node:http";
import { isIP } from "node:net";

const NGINX = "172.30.42.10";
const CLIENTS = { trusted: "172.30.42.20", outsider: "172.30.42.99" };
const MiB = 1024 * 1024;
/** What the client reports when the server closes the connection without answering. */
const CLOSED = ["ECONNRESET", "socket hang up"];

const mode = process.argv[2];
const layout = process.argv[3] ?? "nginx.conf";
const self = CLIENTS[mode];
if (!self || !["nginx.conf", "nginx.split.conf"].includes(layout)) {
	console.error(
		"usage: node check.mjs trusted|outsider [nginx.conf|nginx.split.conf]",
	);
	process.exit(2);
}
const split = layout === "nginx.split.conf";
/** Where the dashboard (and its account links) and the API answer in this layout. */
const DASHBOARD = split ? "app.tattoodrip.app" : "tattoodrip.app";
const API = split ? "api.tattoodrip.app" : "tattoodrip.app";

let failures = 0;
function check(name, ok, detail = "") {
	console.log(
		`${ok ? "ok  " : "FAIL"} [${mode} ${layout}] ${name}${ok ? "" : `: ${detail}`}`,
	);
	if (!ok) failures += 1;
}

/**
 * One request to nginx with an explicit Host header. Resolves to
 * { status, json } once the response is read, or { error } when the connection
 * was closed before any response. Errors after the response head are ignored:
 * on a 413 nginx may close while the client is still sending.
 */
function send({ method = "GET", path = "/", host, headers = {}, body }) {
	return new Promise((resolve) => {
		const req = http.request(
			{
				host: NGINX,
				port: 80,
				method,
				path,
				agent: false,
				timeout: 30_000,
				headers: {
					Host: host,
					...headers,
					...(body ? { "Content-Length": body.length } : {}),
				},
			},
			(res) => {
				const chunks = [];
				let finished = false;
				const finish = () => {
					if (finished) return;
					finished = true;
					const text = Buffer.concat(chunks).toString("utf8");
					let json;
					try {
						json = JSON.parse(text);
					} catch {}
					resolve({ status: res.statusCode, headers: res.headers, json, text });
				};
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("end", finish);
				res.on("close", finish);
				res.on("error", finish);
			},
		);
		let answered = false;
		req.on("response", () => {
			answered = true;
		});
		req.on("timeout", () => req.destroy(new Error("timeout")));
		req.on("error", (error) => {
			if (!answered) resolve({ error: error.code ?? error.message });
		});
		req.end(body);
	});
}

async function waitForNginx() {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const answer = await send({ host: "tattoodrip.app", path: "/" });
		if (answer.status === 200) return;
		await new Promise((done) => setTimeout(done, 1000));
	}
	console.error("nginx did not answer within 40 s");
	process.exit(1);
}

const SPOOF = {
	"CF-Connecting-IP": "203.0.113.7",
	"X-Forwarded-For": "1.2.3.4, 5.6.7.8",
	"X-Forwarded-Host": "evil.example",
	Forwarded: "for=1.2.3.4;host=evil.example",
};

/** What the visitor sent in X-Forwarded-Host and Forwarded must not reach the app. */
function forwardingIsClean(seen, host) {
	return seen["x-forwarded-host"] === host && seen.forwarded === undefined;
}

/** The address both apps must see: the visitor behind cloudflared, else the peer's own. */
const expectedVisitor = mode === "trusted" ? "203.0.113.7" : self;

async function checkVisitorAddress() {
	const targets = [
		[DASHBOARD, "/", "web"],
		["drip-tattoo.tattoodrip.page", "/", "storefront"],
	];
	if (split) {
		targets.push(
			[API, "/api/v1/styles", "web"],
			["tattoodrip.app", "/", "discover"],
		);
	}
	for (const [host, path, upstream] of targets) {
		const { status, json } = await send({ host, path, headers: SPOOF });
		const seen = json?.headers ?? {};
		check(
			`${upstream}: x-forwarded-for is exactly ${expectedVisitor}`,
			status === 200 && seen["x-forwarded-for"] === expectedVisitor,
			`status ${status}, x-forwarded-for ${seen["x-forwarded-for"]}`,
		);
		check(
			`${upstream}: x-real-ip is ${expectedVisitor}`,
			seen["x-real-ip"] === expectedVisitor,
			`x-real-ip ${seen["x-real-ip"]}`,
		);
		check(
			`${upstream}: x-forwarded-proto is https and host is unchanged`,
			seen["x-forwarded-proto"] === "https" && seen.host === host,
			`proto ${seen["x-forwarded-proto"]}, host ${seen.host}`,
		);
		check(
			`${upstream}: a visitor's X-Forwarded-Host and Forwarded are replaced and dropped`,
			forwardingIsClean(seen, host),
			`x-forwarded-host ${seen["x-forwarded-host"]}, forwarded ${seen.forwarded}`,
		);
		check(
			`${upstream}: the app's peer is nginx (${NGINX})`,
			json?.remote === NGINX,
			`remote ${json?.remote}`,
		);
	}
}

async function checkHosts() {
	const routed = split
		? [
				["app.tattoodrip.app", "/", "web"],
				["app.tattoodrip.app", "/t/needle/today", "web"],
				["api.tattoodrip.app", "/api/v1/tenants/needle", "web"],
				["tattoodrip.app", "/", "discover"],
				["tattoodrip.app", "/tattoos", "discover"],
			]
		: [["tattoodrip.app", "/", "web"]];
	for (const [host, path, upstream] of [
		...routed,
		["drip-tattoo.tattoodrip.page", "/", "storefront"],
		["tattoodrip.page", "/", "storefront"],
	]) {
		const { status, json } = await send({ host, path });
		check(
			`Host ${host}${path} goes to ${upstream}`,
			status === 200 && json?.upstream === upstream && json?.url === path,
			`status ${status}, upstream ${json?.upstream}, url ${json?.url}`,
		);
	}
	// The live layout answers no new host before the cutover; neither layout
	// answers a name it does not list.
	const unknown = [
		"evil.example",
		NGINX,
		"tattoodrip.app.evil.example",
		"tattoodrip.page.evil.example",
		"www.tattoodrip.app",
		"discover.tattoodrip.app",
	];
	if (!split) unknown.push("app.tattoodrip.app", "api.tattoodrip.app");
	for (const host of unknown) {
		const answer = await send({ host });
		// nginx's 444 closes the connection: the client sees a reset or a hang-up,
		// not a response and not a wait until its own timeout.
		check(
			`Host ${host} is closed without a response`,
			answer.status === undefined && CLOSED.includes(answer.error),
			`status ${answer.status}, error ${answer.error}`,
		);
	}
}

async function checkWithoutCloudflareHeader() {
	// cloudflared always sets CF-Connecting-IP; if it ever did not, or sent
	// something that is not an address, a spoofed X-Forwarded-For must still not
	// get through: the app sees the peer's own address.
	for (const [name, headers] of [
		["no CF-Connecting-IP", {}],
		["CF-Connecting-IP: not-an-ip", { "CF-Connecting-IP": "not-an-ip" }],
	]) {
		const { json } = await send({
			host: DASHBOARD,
			headers: { "X-Forwarded-For": "1.2.3.4", ...headers },
		});
		check(
			`${name}: x-forwarded-for is the peer, ${self}`,
			json?.headers?.["x-forwarded-for"] === self,
			`x-forwarded-for ${json?.headers?.["x-forwarded-for"]}`,
		);
	}
}

async function checkAddressList() {
	// Cloudflare sets one address, but if the header ever held a list, the app
	// must still get exactly one valid address. Without real_ip_recursive nginx
	// takes the last entry of the list (198.51.100.2): an address Cloudflare's
	// own proxy chain put there, if anyone did.
	const { json } = await send({
		host: DASHBOARD,
		headers: {
			"CF-Connecting-IP": "198.51.100.1, 198.51.100.2",
			"X-Forwarded-For": "1.2.3.4",
		},
	});
	const seen = json?.headers?.["x-forwarded-for"];
	check(
		"CF-Connecting-IP with two addresses: x-forwarded-for is one valid address, the last (198.51.100.2)",
		isIP(seen ?? "") !== 0 && seen === "198.51.100.2",
		`x-forwarded-for ${seen}`,
	);
}

async function checkBodyLimit() {
	const tooBig = await send({
		method: "POST",
		path: "/upload",
		host: DASHBOARD,
		body: Buffer.alloc(22 * MiB, 0x61),
	});
	check(
		"22 MiB POST is refused with 413",
		tooBig.status === 413,
		`status ${tooBig.status}, error ${tooBig.error}`,
	);

	const fits = await send({
		method: "POST",
		path: "/upload",
		host: DASHBOARD,
		body: Buffer.alloc(20 * MiB, 0x61),
	});
	check(
		"20 MiB POST reaches the app whole (200)",
		fits.status === 200 && fits.json?.bytes === 20 * MiB,
		`status ${fits.status}, bytes ${fits.json?.bytes}, error ${fits.error}`,
	);
}

async function checkTokenPaths() {
	const paths = [
		[API, "/api/v1/tenants/x/deposits/tok-canary-1"],
		[DASHBOARD, "/reset-password/tok-canary-2"],
		[DASHBOARD, "/verify-email/tok-canary-3"],
		[DASHBOARD, "/invitations/tok-canary-4"],
	];
	for (const [host, path] of paths) {
		const { status, json } = await send({ host, path, headers: SPOOF });
		const seen = json?.headers ?? {};
		check(
			`${host}${path} reaches web unchanged, with the same proxy headers`,
			status === 200 &&
				json?.upstream === "web" &&
				json?.url === path &&
				seen["x-forwarded-for"] === expectedVisitor &&
				seen["x-forwarded-proto"] === "https" &&
				seen.host === host &&
				forwardingIsClean(seen, host),
			`status ${status}, url ${json?.url}, x-forwarded-for ${seen["x-forwarded-for"]}, proto ${seen["x-forwarded-proto"]}, host ${seen.host}, x-forwarded-host ${seen["x-forwarded-host"]}, forwarded ${seen.forwarded}`,
		);
	}
	// nginx also writes request lines into warn and error log lines: a body
	// buffered to a temporary file (a payment screenshot upload is one) and an
	// upstream that fails. Neither may hold a token.
	const upload = await send({
		method: "POST",
		path: "/api/v1/tenants/x/deposits/tok-canary-5",
		host: API,
		body: Buffer.alloc(64 * 1024, 0x61),
	});
	check(
		"a 64 KiB POST to a deposit path reaches web whole",
		upload.status === 200 && upload.json?.bytes === 64 * 1024,
		`status ${upload.status}, bytes ${upload.json?.bytes}`,
	);
	const failing = await send({
		host: DASHBOARD,
		path: "/reset-password/tok-canary-6?abort=1",
	});
	check(
		"a failing upstream on an account link answers 502",
		failing.status === 502,
		`status ${failing.status}, error ${failing.error}`,
	);
	// nginx rejects some requests before it picks a location, so the locations'
	// own access_log off does not apply: a header larger than a buffer is a 400.
	for (const [host, path] of [
		[DASHBOARD, "/reset-password/tok-canary-7"],
		[API, "/api/v1/tenants/x/deposits/tok-canary-8"],
	]) {
		const rejected = await send({
			host,
			path,
			headers: { "X-Padding": "a".repeat(20_000) },
		});
		check(
			`${path} with an oversized header is rejected with 400`,
			rejected.status === 400,
			`status ${rejected.status}, error ${rejected.error}`,
		);
	}
	// The one request that must be logged (run.sh looks for it, and for its address).
	const login = await send({
		host: DASHBOARD,
		path: "/login",
		headers: { ...SPOOF, "CF-Connecting-IP": "203.0.113.9" },
	});
	check(
		"/login reaches web",
		login.status === 200 && login.json?.upstream === "web",
		`status ${login.status}`,
	);
}

/**
 * The D11 layout only: links made before the cutover keep working. Old
 * dashboard and account addresses on the apex are sent to Studio OS (307, same
 * path and query, method kept); the old API address is proxied, not
 * redirected; the API host serves /api only; the dashboard host does not
 * redirect again (no loop); the old service worker is replaced.
 */
async function checkLegacy() {
	const STUDIO_OS = "https://app.tattoodrip.app";
	for (const [method, path] of [
		["GET", "/login"],
		["GET", "/dashboard"],
		["GET", "/signup/sent"],
		["GET", "/t/needle/projects?status=open"],
		["GET", "/account"],
		["GET", "/onboarding"],
		["POST", "/login"],
		["POST", "/logout"],
		["GET", "/reset-password/tok-canary-11"],
		["GET", "/verify-email/tok-canary-12"],
		["GET", "/invitations/tok-canary-13"],
	]) {
		const answer = await send({
			method,
			path,
			host: "tattoodrip.app",
			body: method === "POST" ? Buffer.from("email=a%40b.c") : undefined,
			headers:
				method === "POST"
					? { "Content-Type": "application/x-www-form-urlencoded" }
					: {},
		});
		check(
			`apex ${method} ${path.replace(/tok-canary-\d+/, "<token>")} is a 307 to Studio OS with the same path`,
			answer.status === 307 &&
				answer.headers?.location === `${STUDIO_OS}${path}` &&
				answer.json === undefined,
			`status ${answer.status}, location ${answer.headers?.location}`,
		);
	}
	// Paths that only start like a dashboard path are Discover's.
	for (const path of [
		"/logins",
		"/dashboards",
		"/t",
		"/tattoos/x",
		"/studios",
	]) {
		const { status, json } = await send({ host: "tattoodrip.app", path });
		check(
			`apex ${path} is Discover's`,
			status === 200 && json?.upstream === "discover",
			`status ${status}, upstream ${json?.upstream}`,
		);
	}
	for (const path of [
		"/api",
		"/api/v1/tenants/needle",
		"/api/v1/tenants/needle/deposits/tok-canary-14",
	]) {
		const { status, json } = await send({ host: "tattoodrip.app", path });
		check(
			`apex ${path.replace(/tok-canary-\d+/, "<token>")} is proxied to web, not redirected`,
			status === 200 &&
				json?.upstream === "web" &&
				json?.url === path &&
				json?.headers?.host === "tattoodrip.app",
			`status ${status}, upstream ${json?.upstream}`,
		);
	}
	const post = await send({
		method: "POST",
		path: "/api/v1/tenants/needle/inquiries",
		host: "tattoodrip.app",
		body: Buffer.alloc(64 * 1024, 0x61),
	});
	check(
		"apex POST /api/... reaches web whole (no redirect)",
		post.status === 200 &&
			post.json?.upstream === "web" &&
			post.json?.bytes === 64 * 1024,
		`status ${post.status}, bytes ${post.json?.bytes}`,
	);
	const bare = await send({ host: API, path: "/api" });
	check(
		"api host /api (no slash) reaches web, as the platform counts it",
		bare.status === 200 && bare.json?.upstream === "web",
		`status ${bare.status}, upstream ${bare.json?.upstream}`,
	);
	for (const path of ["/", "/login", "/t/needle/today", "/sw.js", "/apix"]) {
		const { status, json } = await send({ host: API, path });
		check(
			`api host ${path} is nginx's 404, never the dashboard`,
			status === 404 && json === undefined,
			`status ${status}, upstream ${json?.upstream}`,
		);
	}
	const target = await send({ host: DASHBOARD, path: "/login" });
	check(
		"the redirect's target is served by web, not redirected again",
		target.status === 200 && target.json?.upstream === "web",
		`status ${target.status}, location ${target.headers?.location}`,
	);
	const worker = await send({ host: "tattoodrip.app", path: "/sw.js" });
	check(
		"apex /sw.js is the unregistering worker, never cached",
		worker.status === 200 &&
			worker.headers?.["content-type"]?.startsWith("application/javascript") &&
			worker.headers?.["cache-control"] === "no-cache" &&
			worker.text.includes("self.registration.unregister()"),
		`status ${worker.status}, type ${worker.headers?.["content-type"]}, cache ${worker.headers?.["cache-control"]}`,
	);
}

await waitForNginx();
await checkVisitorAddress();
if (mode === "trusted") {
	await checkHosts();
	await checkWithoutCloudflareHeader();
	await checkAddressList();
	await checkBodyLimit();
	await checkTokenPaths();
	if (split) await checkLegacy();
} else {
	await checkWithoutCloudflareHeader();
}

console.log(
	failures === 0
		? `[${mode}] all checks passed`
		: `[${mode}] ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
