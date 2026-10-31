// Runs inside a client container on the tattoo_drip subnet and talks to nginx
// at its fixed address, like cloudflared does in production.
//
//   node check.mjs trusted    from 172.30.42.20 (cloudflared's address)
//   node check.mjs outsider   from 172.30.42.99 (anything else)
//
// Prints one line per check and exits 1 when any failed. run.sh starts it from
// each client and then checks nginx's access log.
import http from "node:http";

const NGINX = "172.30.42.10";
const CLIENTS = { trusted: "172.30.42.20", outsider: "172.30.42.99" };
const MiB = 1024 * 1024;

const mode = process.argv[2];
const self = CLIENTS[mode];
if (!self) {
	console.error("usage: node check.mjs trusted|outsider");
	process.exit(2);
}

let failures = 0;
function check(name, ok, detail = "") {
	console.log(
		`${ok ? "ok  " : "FAIL"} [${mode}] ${name}${ok ? "" : `: ${detail}`}`,
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
					resolve({ status: res.statusCode, json, text });
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
};

/** The address both apps must see: the visitor behind cloudflared, else the peer's own. */
const expectedVisitor = mode === "trusted" ? "203.0.113.7" : self;

async function checkVisitorAddress() {
	for (const [host, upstream] of [
		["tattoodrip.app", "web"],
		["drip-tattoo.tattoodrip.page", "storefront"],
	]) {
		const { status, json } = await send({ host, headers: SPOOF });
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
	}
}

async function checkHosts() {
	for (const [host, upstream] of [
		["tattoodrip.app", "web"],
		["drip-tattoo.tattoodrip.page", "storefront"],
		["tattoodrip.page", "storefront"],
	]) {
		const { status, json } = await send({ host });
		check(
			`Host ${host} goes to ${upstream}`,
			status === 200 && json?.upstream === upstream,
			`status ${status}, upstream ${json?.upstream}`,
		);
	}
	for (const host of [
		"evil.example",
		NGINX,
		"tattoodrip.app.evil.example",
		"tattoodrip.page.evil.example",
	]) {
		const answer = await send({ host });
		check(
			`Host ${host} is closed without a response`,
			answer.status === undefined && answer.error !== undefined,
			`status ${answer.status}, error ${answer.error}`,
		);
	}
}

async function checkWithoutCloudflareHeader() {
	// cloudflared always sets CF-Connecting-IP; if it ever did not, a spoofed
	// X-Forwarded-For must still not get through.
	const { json } = await send({
		host: "tattoodrip.app",
		headers: { "X-Forwarded-For": "1.2.3.4" },
	});
	check(
		`no CF-Connecting-IP: x-forwarded-for is the peer, ${self}`,
		json?.headers?.["x-forwarded-for"] === self,
		`x-forwarded-for ${json?.headers?.["x-forwarded-for"]}`,
	);
}

async function checkBodyLimit() {
	const tooBig = await send({
		method: "POST",
		path: "/upload",
		host: "tattoodrip.app",
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
		host: "tattoodrip.app",
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
		"/api/v1/tenants/x/deposits/tok-canary-1",
		"/reset-password/tok-canary-2",
		"/verify-email/tok-canary-3",
		"/invitations/tok-canary-4",
	];
	for (const path of paths) {
		const { status, json } = await send({
			host: "tattoodrip.app",
			path,
			headers: SPOOF,
		});
		const seen = json?.headers ?? {};
		check(
			`${path} reaches web unchanged, with the same proxy headers`,
			status === 200 &&
				json?.upstream === "web" &&
				json?.url === path &&
				seen["x-forwarded-for"] === expectedVisitor &&
				seen["x-forwarded-proto"] === "https" &&
				seen.host === "tattoodrip.app",
			`status ${status}, url ${json?.url}, x-forwarded-for ${seen["x-forwarded-for"]}, proto ${seen["x-forwarded-proto"]}, host ${seen.host}`,
		);
	}
	// nginx also writes request lines into warn and error log lines: a body
	// buffered to a temporary file (a payment screenshot upload is one) and an
	// upstream that fails. Neither may hold a token.
	const upload = await send({
		method: "POST",
		path: "/api/v1/tenants/x/deposits/tok-canary-5",
		host: "tattoodrip.app",
		body: Buffer.alloc(64 * 1024, 0x61),
	});
	check(
		"a 64 KiB POST to a deposit path reaches web whole",
		upload.status === 200 && upload.json?.bytes === 64 * 1024,
		`status ${upload.status}, bytes ${upload.json?.bytes}`,
	);
	const failing = await send({
		host: "tattoodrip.app",
		path: "/reset-password/tok-canary-6?abort=1",
	});
	check(
		"a failing upstream on an account link answers 502",
		failing.status === 502,
		`status ${failing.status}, error ${failing.error}`,
	);
	// The one request that must be logged (run.sh looks for it, and for its address).
	const login = await send({
		host: "tattoodrip.app",
		path: "/login",
		headers: { ...SPOOF, "CF-Connecting-IP": "203.0.113.9" },
	});
	check(
		"/login reaches web",
		login.status === 200 && login.json?.upstream === "web",
		`status ${login.status}`,
	);
}

await waitForNginx();
await checkVisitorAddress();
if (mode === "trusted") {
	await checkHosts();
	await checkWithoutCloudflareHeader();
	await checkBodyLimit();
	await checkTokenPaths();
} else {
	await checkWithoutCloudflareHeader();
}

console.log(
	failures === 0
		? `[${mode}] all checks passed`
		: `[${mode}] ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
