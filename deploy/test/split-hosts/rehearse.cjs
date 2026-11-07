// The split hosts' local rehearsal (Discover D01, docs/discover/domain-migration.md,
// "Rehearsal"): drives the real platform and storefront in Chromium and prints one
// line per check. Start them first, on their own throwaway database:
//
//   platform (apps/platform):   APP_URL=http://app.localhost:3333 API_URL=http://api.localhost:3333
//                               DISCOVER_URL=http://localhost:3100 pnpm dev   (and pnpm worker)
//   storefront (apps/storefront): PORT=3000 API_URL=http://api.localhost:3333
//                               STOREFRONT_URL=http://{tenant}.localhost:3000 pnpm dev
//   Mailpit on 127.0.0.1:1025 / :8025 (the root docker-compose.yml)
//   /etc/hosts: 127.0.0.1 api.localhost   (the storefront's server resolves it)
//
// Then, with the platform's environment in the shell (for `node ace account:verify`)
// and Playwright resolvable (not a repo dependency; NODE_PATH to an installed copy):
//
//   node deploy/test/split-hosts/rehearse.cjs
//
// It creates an account and a studio each run. Never point it at a real database.
const { execFileSync } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const PLATFORM_DIR = path.resolve(__dirname, "../../../apps/platform");
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";

const APP = "http://app.localhost:3333";
const API = "http://api.localhost:3333";
const SLUG = `rehearsal-d01-${Date.now().toString(36)}`;
const STUDIO = `http://${SLUG}.localhost:3000`;
const EMAIL = `owner+${Date.now()}@rehearsal.example`;
const PASSWORD = "rehearsal-password-1";

let failures = 0;
const results = [];
function check(name, ok, detail = "") {
	results.push(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: ${detail}`}`);
	if (!ok) failures++;
}

(async () => {
	// An unlisted origin's page, for the blocked cross-origin read.
	const evil = http
		.createServer((_, res) => res.end("<!doctype html><title>evil</title>"))
		.listen(3999);

	const browser = await chromium.launch();
	const ctx = await browser.newContext();
	const page = await ctx.newPage();

	// 1. Sign up on the dashboard's host (a CSRF-protected write).
	await page.goto(`${APP}/signup`);
	await page.fill('input[name="fullName"]', "Rehearsal Owner");
	await page.fill('input[name="email"]', EMAIL);
	await page.fill('input[name="password"]', PASSWORD);
	await page.fill('input[name="passwordConfirmation"]', PASSWORD);
	await page.click('button[type="submit"]');
	await page.waitForURL(/\/signup\/sent|\/confirm-email/, { timeout: 15000 });
	check("signup on app host", true);

	execFileSync("node", ["ace", "account:verify", EMAIL], {
		cwd: PLATFORM_DIR,
		env: process.env,
		stdio: "pipe",
	});

	// 2. Sign in (fresh context: the signup may have left a session).
	await ctx.clearCookies();
	await page.goto(`${APP}/login`);
	await page.fill('input[name="email"]', EMAIL);
	await page.fill('input[name="password"]', PASSWORD);
	await page.click('button[type="submit"]');
	await page.waitForURL(/\/onboarding|\/t\//, { timeout: 15000 });
	check("sign in redirects into the app", true, page.url());

	const cookies = await ctx.cookies();
	const session = cookies.find((c) => c.name === "td-session");
	const xsrf = cookies.find((c) => c.name === "XSRF-TOKEN");
	check(
		"session cookie is host-only on app.localhost, HttpOnly, SameSite Lax",
		session &&
			session.domain === "app.localhost" &&
			session.httpOnly &&
			session.sameSite === "Lax",
		JSON.stringify(session),
	);
	check(
		"XSRF cookie is host-only on app.localhost",
		xsrf && xsrf.domain === "app.localhost",
		JSON.stringify(xsrf),
	);
	check(
		"no cookie on any other host",
		cookies.every((c) => c.domain === "app.localhost"),
		JSON.stringify(cookies.map((c) => c.domain)),
	);

	// 3. Onboarding: create the studio (a CSRF-protected write).
	if (!page.url().includes("/t/")) {
		await page.goto(`${APP}/onboarding`);
		await page.fill('input[name="name"]', "Rehearsal Studio");
		await page.fill('input[name="slug"]', SLUG);
		await page.click('button[type="submit"]');
		await page.waitForURL(new RegExp(`/t/${SLUG}`), { timeout: 15000 });
	}
	check(
		"onboarding lands in the tenant dashboard",
		page.url().includes(`/t/${SLUG}`),
		page.url(),
	);

	// 4. A settings write (Inertia PUT with X-XSRF-TOKEN).
	await page.goto(`${APP}/t/${SLUG}/settings/profile`);
	await page.fill('textarea[name="intro"]', "Rehearsed on the split hosts.");
	await page.click('button:has-text("Save profile")');
	await page.waitForTimeout(1500);
	const studioJson = await (
		await fetch(`${API}/api/v1/tenants/${SLUG}`, {
			headers: { "cache-control": "no-cache" },
		})
	).json();
	check(
		"profile write saved (read back through the API host)",
		studioJson?.data?.intro === "Rehearsed on the split hosts.",
		JSON.stringify(studioJson?.data?.intro),
	);

	// 5. The API host serves /api only, and sets no cookie.
	const apiPage = await page.goto(`${API}/login`);
	check(
		"api host /login is the API's 404 JSON",
		apiPage.status() === 404 && (await apiPage.text()).includes('"not_found"'),
		`status ${apiPage.status()}`,
	);
	check(
		"api host set no cookie",
		(await ctx.cookies()).every((c) => c.domain === "app.localhost"),
	);
	const apiRead = await page.goto(`${API}/api/v1/tenants/${SLUG}`);
	check("api host serves the studio read", apiRead.status() === 200);

	// 6. The storefront renders from the API host (server-side).
	const store = await page.goto(STUDIO);
	// The server's HTML, before hydration removes the dehydrated state's script.
	const html = await store.text();
	check(
		"storefront page renders (SSR via api.localhost)",
		store.status() === 200 && html.includes("Rehearsal Studio"),
		`status ${store.status()}`,
	);
	check(
		"storefront dehydrates the split API origin for the browser",
		html.includes("http://api.localhost:3333"),
	);

	// 7. Browser calls from the studio page: a read and a preflighted inquiry POST.
	const fromStudio = await page.evaluate(
		async ({ API, SLUG }) => {
			const read = await fetch(`${API}/api/v1/tenants/${SLUG}/artists`);
			const form = new FormData();
			form.set("idea", "A small fine line swallow");
			form.set("contactName", "Rehearsal Client");
			form.set("contactPhone", "9812345678");
			form.set("sourceChannel", "instagram");
			const post = await fetch(`${API}/api/v1/tenants/${SLUG}/inquiries`, {
				method: "POST",
				body: form,
				headers: { "X-Challenge-Token": "dev-token" },
			});
			return {
				read: read.status,
				readBody: await read.text(),
				post: post.status,
				postBody: await post.text(),
			};
		},
		{ API, SLUG },
	);
	check(
		"cross-origin read from the studio page succeeds",
		fromStudio.read === 200,
		JSON.stringify(fromStudio),
	);
	check(
		"preflighted inquiry POST from the studio page reaches the API and its answer is readable",
		[201, 409, 422].includes(fromStudio.post) &&
			fromStudio.postBody.includes("{"),
		`status ${fromStudio.post} ${fromStudio.postBody.slice(0, 200)}`,
	);

	// 8. The same read from an unlisted origin is blocked by the browser.
	await page.goto("http://evil.localhost:3999/");
	const fromEvil = await page.evaluate(async (url) => {
		try {
			await fetch(url);
			return "readable";
		} catch (error) {
			return `blocked: ${error.message}`;
		}
	}, `${API}/api/v1/tenants/${SLUG}/artists`);
	check(
		"cross-origin read from an unlisted origin is blocked",
		fromEvil.startsWith("blocked"),
		fromEvil,
	);

	// 9. Sign out (CSRF-protected POST), then the dashboard sends a guest to sign in.
	await page.goto(`${APP}/t/${SLUG}/today`);
	const logout = await page.evaluate(async () => {
		const token = decodeURIComponent(
			document.cookie
				.split("; ")
				.find((c) => c.startsWith("XSRF-TOKEN="))
				?.split("=")[1] ?? "",
		);
		const res = await fetch("/logout", {
			method: "POST",
			headers: { "X-XSRF-TOKEN": token, "X-Requested-With": "XMLHttpRequest" },
			redirect: "follow",
		});
		return { status: res.status, url: res.url };
	});
	check(
		"sign out returns to /login",
		logout.url.endsWith("/login"),
		JSON.stringify(logout),
	);
	await page.goto(`${APP}/t/${SLUG}/today`);
	check(
		"signed out, a tenant page sends the guest to /login",
		page.url().endsWith("/login"),
		page.url(),
	);

	// 10. Absolute links: a password reset email names the dashboard's host.
	await page.goto(`${APP}/forgot-password`);
	await page.fill('input[name="email"]', EMAIL);
	await page.click('button[type="submit"]');
	await page.waitForTimeout(2000);
	const mails = await (await fetch(`${MAILPIT}/api/v1/messages`)).json();
	const latest = mails.messages?.[0];
	let resetLink = "";
	if (latest) {
		const full = await (
			await fetch(`${MAILPIT}/api/v1/message/${latest.ID}`)
		).json();
		resetLink = (full.Text.match(/https?:\/\/\S+reset-password\/\S+/) ?? [
			"",
		])[0];
	}
	check(
		"a reset email links to the dashboard's host",
		resetLink.startsWith(`${APP}/reset-password/`),
		resetLink.replace(/reset-password\/\S+/, "reset-password/<token>") ||
			"no mail",
	);

	await browser.close();
	evil.close();
	console.log(results.join("\n"));
	console.log(
		failures === 0
			? "rehearsal: all checks passed"
			: `rehearsal: ${failures} failed`,
	);
	process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
	console.log(results.join("\n"));
	console.error(error);
	process.exit(1);
});
