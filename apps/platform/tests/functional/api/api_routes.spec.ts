import router from "@adonisjs/core/services/router";
import { test } from "@japa/runner";
import bodyParserConfig from "#config/bodyparser";
import { middleware } from "#start/kernel";
import { publicIsolationCases } from "#tests/isolation/public_cases";

/** The named middleware (start/kernel.ts); global ones may carry names too. */
const NAMED = new Set(Object.keys(middleware));

/** Session-dependent middleware that no API route may run. */
const WEB_ONLY = ["auth", "guest", "dbContext", "tenant", "role"];

/** Middleware only API routes may run. */
const PUBLIC_ONLY = ["publicApi", "publicTenant", "publicCache"];

/**
 * API GET routes that are not cacheable, and why. A new GET route either
 * uses middleware.publicCache() or is listed here: a conscious edit (the
 * deposit page, TAT-65, belongs here).
 */
const UNCACHED_GET_ROUTES: Record<string, string> = {
	"/api/v1/tenants/:tenant/deposits/:token":
		"A private deposit page behind a bearer link: never cached (TAT-65).",
};

const isApi = (pattern: string) =>
	pattern === "/api" || pattern.startsWith("/api/");
const isTenantApi = (pattern: string) =>
	/^\/api\/v1\/tenants\/:tenant(\/|$)/.test(pattern);
/** Test-only routes (tests/support/test_routes.ts) follow the stack rules but need no case or cache decision. */
const isTestOnly = (pattern: string) => pattern.includes("/__test");

function allRoutes() {
	return Object.values(router.toJSON())
		.flat()
		.map((route) => ({
			pattern: route.pattern,
			methods: route.methods.filter((method) => method !== "HEAD"),
			named: [...route.middleware.all()].flatMap((entry) =>
				typeof entry !== "function" && entry.name && NAMED.has(entry.name)
					? [entry.name]
					: [],
			),
		}));
}

test.group("Public API routes", () => {
	test("every /api route runs publicApi first and none of the web middleware", ({
		assert,
	}) => {
		const routes = allRoutes().filter(({ pattern }) => isApi(pattern));
		assert.isNotEmpty(routes);

		for (const { pattern, named } of routes) {
			assert.equal(named[0], "publicApi", pattern);
			for (const name of WEB_ONLY) assert.notInclude(named, name, pattern);
		}
	});

	test("every tenant route resolves the tenant after publicApi", ({
		assert,
	}) => {
		const routes = allRoutes().filter(({ pattern }) => isTenantApi(pattern));
		assert.isNotEmpty(routes);

		for (const { pattern, named } of routes) {
			assert.isAbove(
				named.indexOf("publicTenant"),
				named.indexOf("publicApi"),
				pattern,
			);
		}
	});

	test("no route outside /api runs the public API middleware", ({ assert }) => {
		for (const { pattern, named } of allRoutes().filter(
			({ pattern }) => !isApi(pattern),
		)) {
			for (const name of PUBLIC_ONLY) assert.notInclude(named, name, pattern);
		}
	});

	test("every API GET route is cacheable or says why not", ({ assert }) => {
		const gets = allRoutes().filter(
			({ pattern, methods }) =>
				isApi(pattern) && !isTestOnly(pattern) && methods.includes("GET"),
		);
		assert.isNotEmpty(gets);

		assert.deepEqual(
			gets
				.filter(
					({ pattern, named }) =>
						!named.includes("publicCache") && !(pattern in UNCACHED_GET_ROUTES),
				)
				.map(({ pattern }) => pattern),
			[],
			"use middleware.publicCache(), or list the route in UNCACHED_GET_ROUTES with a reason",
		);
		assert.deepEqual(
			Object.keys(UNCACHED_GET_ROUTES).filter(
				(pattern) => !gets.some((route) => route.pattern === pattern),
			),
			[],
			"UNCACHED_GET_ROUTES lists routes that no longer exist",
		);
	});

	test("no API route lets the body parser write a multipart body before the tenant is known", ({
		assert,
	}) => {
		const writes = allRoutes().filter(
			({ pattern, methods }) =>
				isApi(pattern) &&
				!isTestOnly(pattern) &&
				methods.some((method) => !["GET", "HEAD"].includes(method)),
		);
		assert.isNotEmpty(writes);

		assert.deepEqual(
			writes
				.map(({ pattern }) => pattern)
				.filter(
					(pattern) =>
						!bodyParserConfig.multipart.processManually.includes(pattern),
				),
			[],
			"list the route in multipart.processManually (config/bodyparser.ts) and read its body with receiveUploads, after publicTenant (TAT-32 ruling 16)",
		);
	});

	test("every /api/v1/tenants/:tenant route has a public isolation case", ({
		assert,
	}) => {
		const keys = new Set(
			allRoutes()
				.filter(({ pattern }) => isTenantApi(pattern) && !isTestOnly(pattern))
				.flatMap(({ pattern, methods }) =>
					methods.map((method) => `${method} ${pattern}`),
				),
		);
		const covered = new Set(
			publicIsolationCases.map(({ method, pattern }) => `${method} ${pattern}`),
		);

		assert.deepEqual(
			[...keys].filter((key) => !covered.has(key)),
			[],
			"add a case to tests/isolation/public_cases.ts",
		);
		assert.deepEqual(
			[...covered].filter((key) => !keys.has(key)),
			[],
			"cases for routes that no longer exist",
		);
	});
});
