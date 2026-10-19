import router from "@adonisjs/core/services/router";
import { test } from "@japa/runner";

/**
 * Routes that create a tenant or accept an invitation: they need a
 * confirmed address (TAT-18). TAT-33 adds accepting an invitation here.
 */
const NEEDS_CONFIRMED_EMAIL = ["GET /onboarding", "POST /onboarding"];

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
	"POST /confirm-email": ["verify_cooldownThrottle", "verify_resendThrottle"],
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

/** Open to guests and signed-in visitors alike (spec ruling 16). */
const OPEN = [
	"GET /verify-email/:token",
	"GET /verify-email",
	"POST /verify-email",
];

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
});
