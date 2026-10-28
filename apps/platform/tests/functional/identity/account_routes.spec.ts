import router from "@adonisjs/core/services/router";
import { test } from "@japa/runner";
import { ACCOUNT_LINK_ROUTES } from "#services/rate_limits";

/**
 * Routes that create a tenant or accept an invitation: they need a
 * confirmed address (TAT-18). Accepting an invitation is TAT-33's.
 */
const NEEDS_CONFIRMED_EMAIL = [
	"GET /onboarding",
	"POST /onboarding",
	"POST /invitations",
];

/**
 * What each account form and link counts, in order. limiter.define names
 * its middleware `<name>Throttle` (start/limiter.ts).
 */
const THROTTLES: Record<string, string[]> = {
	"POST /signup": ["signupThrottle", "signup_emailThrottle"],
	"POST /forgot-password": ["reset_ipThrottle", "reset_emailThrottle"],
	"GET /reset-password/:token": ["account_linksThrottle"],
	"POST /reset-password": ["account_linksThrottle"],
	"GET /verify-email/:token": ["account_linksThrottle"],
	"POST /verify-email": ["account_linksThrottle"],
	"GET /invitations/:token": ["account_linksThrottle"],
	"POST /invitations": ["account_linksThrottle"],
	"POST /confirm-email": ["verify_cooldownThrottle", "verify_resendThrottle"],
	// Counted inside the handler, not by the route (TAT-95): the wrong current
	// passwords (throttlePasswordCheck: a right one gives its points back) and
	// the successful changes (checked first, counted after the commit), so a
	// refused or malformed request never spends the cap.
	"PUT /account/password": [],
	// One count per account and client address, then a loose one per account.
	"POST /account/sign-out-others": [
		"sign_out_othersThrottle",
		"sign_out_others_accountThrottle",
	],
};

/** Where someone new may start: guest pages, which clear page history (TAT-82). */
const GUEST = [
	"GET /signup",
	"POST /signup",
	"GET /signup/sent",
	"GET /login",
	"POST /login",
	"GET /forgot-password",
	"POST /forgot-password",
	"GET /forgot-password/sent",
	"GET /reset-password/:token",
	"GET /reset-password",
	"POST /reset-password",
];

/** Open to guests and signed-in visitors alike (TAT-18 spec ruling 16; the invitation page, TAT-33). */
const OPEN = [
	"GET /verify-email/:token",
	"GET /verify-email",
	"POST /verify-email",
	"GET /invitations/:token",
	"GET /invitations",
];

/**
 * The signed-in routes outside a studio (TAT-95): auth, then the request
 * transaction, and no tenant, role or guest middleware. Together with GUEST,
 * OPEN and the home redirect, this is every route that is not a studio's
 * (`/t/:tenant`), the API or a test/file route: a new one fails the test below
 * until it is listed, so none ships unguarded by accident.
 */
const SIGNED_IN = [
	"GET /dashboard",
	"POST /logout",
	"GET /confirm-email",
	"POST /confirm-email",
	"GET /onboarding",
	"POST /onboarding",
	"POST /invitations",
	"GET /account",
	"PUT /account/password",
	"POST /account/sign-out-others",
];

/** What drive serves (config/drive.ts): uploads and files, not pages. */
const FILE_ROUTES = ["GET /uploads/*", "GET /files/*"];

/** `GET /` redirects by itself, to /dashboard or /login. */
const HOME = ["GET /"];

/** Every route's "METHOD pattern" keys (HEAD left out: Adonis adds it to each GET). */
function allRouteKeys(): string[] {
	return Object.values(router.toJSON())
		.flat()
		.flatMap((entry) =>
			entry.methods
				.filter((method) => method !== "HEAD")
				.map((method) => `${method} ${entry.pattern}`),
		);
}

/** The route's own middleware names, in the order they run. */
function middlewareOf(key: string): string[] {
	const [method, pattern] = key.split(" ");
	const route = Object.values(router.toJSON())
		.flat()
		.find(
			(entry) => entry.pattern === pattern && entry.methods.includes(method),
		);
	if (!route) throw new Error(`No route ${key}`);
	return [...route.middleware.all()].flatMap((entry) =>
		entry.name ? [entry.name] : [],
	);
}

test.group("Account routes (TAT-18)", () => {
	test("every route that creates a tenant or accepts an invitation runs verifiedEmail after auth", ({
		assert,
	}) => {
		for (const key of NEEDS_CONFIRMED_EMAIL) {
			const names = middlewareOf(key);
			assert.isAtLeast(names.indexOf("auth"), 0, key);
			assert.isAbove(
				names.indexOf("verifiedEmail"),
				names.indexOf("auth"),
				key,
			);
		}
	});

	test("every account form and link counts its requests", ({ assert }) => {
		for (const [key, throttles] of Object.entries(THROTTLES)) {
			assert.deepEqual(
				middlewareOf(key).filter((name) => name.endsWith("Throttle")),
				throttles,
				key,
			);
		}
	});

	test("every throttled GET link is one that says so when it is refused (TAT-119)", ({
		assert,
	}) => {
		const links = Object.values(router.toJSON())
			.flat()
			.filter(
				(entry) =>
					entry.methods.includes("GET") &&
					[...entry.middleware.all()].some(
						(middleware) => middleware.name === "account_linksThrottle",
					),
			)
			.map((entry) => entry.name);
		assert.sameMembers(links as string[], [...ACCOUNT_LINK_ROUTES]);
	});

	test("the pages where someone new may start are guest pages; the confirmation page isn't", ({
		assert,
	}) => {
		for (const key of GUEST) assert.include(middlewareOf(key), "guest", key);
		for (const key of OPEN) {
			const names = middlewareOf(key);
			assert.notInclude(names, "guest", key);
			assert.notInclude(names, "auth", key);
		}
		assert.include(middlewareOf("GET /confirm-email"), "auth");
	});

	test("the signed-in routes outside a studio run auth, then the request transaction, and nothing about a studio or a guest (TAT-95)", ({
		assert,
	}) => {
		for (const key of SIGNED_IN) {
			const names = middlewareOf(key);
			assert.isAtLeast(names.indexOf("auth"), 0, key);
			assert.isAbove(names.indexOf("dbContext"), names.indexOf("auth"), key);
			for (const other of ["tenant", "role", "guest"]) {
				assert.notInclude(names, other, `${key} runs ${other}`);
			}
		}
	});

	test("every route outside a studio, the API and the test and file routes is listed as guest, open or signed-in (TAT-95)", ({
		assert,
	}) => {
		const listed = [...GUEST, ...OPEN, ...SIGNED_IN, ...HOME];
		const keys = allRouteKeys();
		const outside = keys.filter((key) => {
			const pattern = key.split(" ")[1];
			return (
				!pattern.startsWith("/t/:tenant") &&
				!pattern.startsWith("/api/") &&
				!pattern.includes("/__test") &&
				!FILE_ROUTES.includes(key)
			);
		});

		assert.deepEqual(
			outside.filter((key) => !listed.includes(key)),
			[],
			"routes no list names: give each its guard and add it to GUEST, OPEN or SIGNED_IN",
		);
		assert.deepEqual(
			listed.filter((key) => !keys.includes(key)),
			[],
			"listed keys that are not routes",
		);
		assert.equal(
			new Set(listed).size,
			listed.length,
			"a route is in two lists",
		);
		assert.deepEqual(
			FILE_ROUTES.filter((key) => !keys.includes(key)),
			[],
			"file routes that are not routes",
		);
	});
});
