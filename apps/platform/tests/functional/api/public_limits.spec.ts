import { mock } from "node:test";
import logger from "@adonisjs/core/services/logger";
import testUtils from "@adonisjs/core/services/test_utils";
import limiter from "@adonisjs/limiter/services/main";
import { test } from "@japa/runner";
import User from "#models/user";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { CALLER_WARNINGS, resetCallerWarnings } from "#services/api_caller";
import { apiLimitFor } from "#services/api_limits";
import { assertApiError } from "#tests/helpers/api";
import { fillApiLimit, testServerKeys } from "#tests/helpers/api_limits";
import { intakeFields, png, postInquiry } from "#tests/helpers/intake";
import {
	closedWithin,
	rawRequest,
	readResponse,
} from "#tests/helpers/raw_http";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { newTempUploads, tempUploads } from "#tests/helpers/uploads";

const SLUG = "limits-38";
const studio = `/api/v1/tenants/${SLUG}`;
const [ONE, TWO] = testServerKeys();
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

test.group("Public API limits: the gate", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => resetCallerWarnings());
	group.each.teardown(() => mock.restoreAll());

	test("an anonymous address over its read budget is a 429 envelope with Retry-After", async ({
		client,
		assert,
	}) => {
		await studioWithOwner(SLUG);
		await fillApiLimit("callerReads", {
			kind: "anonymous",
			ip: "203.0.113.40",
		});

		const refused = await client
			.get(studio)
			.header("x-forwarded-for", "203.0.113.40");
		assertApiError(refused, 429, "rate_limited");
		assert.isAbove(Number(refused.header("retry-after")), 0);

		(
			await client.get(studio).header("x-forwarded-for", "203.0.113.41")
		).assertStatus(200);
	});

	test("reads and writes have budgets of their own; unknown slugs count too", async ({
		client,
		assert,
	}) => {
		await fillApiLimit("callerWrites", {
			kind: "anonymous",
			ip: "203.0.113.42",
		});
		assertApiError(
			await client
				.post("/api/v1/__test/echo")
				.header("x-forwarded-for", "203.0.113.42")
				.json({ label: "x" }),
			429,
			"rate_limited",
		);
		(
			await client
				.get("/api/v1/__test/ok")
				.header("x-forwarded-for", "203.0.113.42")
		).assertStatus(200);

		assertApiError(
			await client
				.get("/api/v1/tenants/no-such-studio-td38")
				.header("x-forwarded-for", "203.0.113.43"),
			404,
			"not_found",
		);
		const { key, budget } = apiLimitFor("callerReads", {
			kind: "anonymous",
			ip: "203.0.113.43",
		});
		assert.equal((await limiter.use({ ...budget }).get(key))?.consumed, 1);
	});

	test("a keyed call counts under its visitor, apart from anonymous calls, with either key", async ({
		client,
	}) => {
		await studioWithOwner(SLUG);
		await fillApiLimit("callerReads", {
			kind: "storefront",
			ip: "203.0.113.44",
		});
		const keyed = (key: string, visitor: string) =>
			client
				.get(studio)
				.header("authorization", `Bearer ${key}`)
				.header("x-visitor-ip", visitor);

		assertApiError(await keyed(ONE, "203.0.113.44"), 429, "rate_limited");
		assertApiError(await keyed(TWO, "203.0.113.44"), 429, "rate_limited");
		(await keyed(ONE, "203.0.113.45")).assertStatus(200);
		(
			await client.get(studio).header("x-forwarded-for", "203.0.113.44")
		).assertStatus(200);
	});

	test("X-Visitor-IP without a valid key changes nothing", async ({
		client,
	}) => {
		await studioWithOwner(SLUG);
		await fillApiLimit("callerReads", {
			kind: "anonymous",
			ip: "203.0.113.46",
		});
		for (const authorization of [
			undefined,
			`Bearer ${"z".repeat(43)}`,
			`Basic ${ONE}`,
		]) {
			const request = client
				.get(studio)
				.header("x-forwarded-for", "203.0.113.46")
				.header("x-visitor-ip", "198.51.100.77");
			if (authorization) request.header("authorization", authorization);
			assertApiError(await request, 429, "rate_limited");
		}
	});

	test("an unknown key is an anonymous caller, warned about once, never logged", async ({
		client,
		assert,
	}) => {
		await studioWithOwner(SLUG);
		const warn = mock.method(logger, "warn", () => {});
		const unknown = `Bearer ${"q".repeat(43)}`;

		(await client.get(studio).header("authorization", unknown)).assertStatus(
			200,
		);
		(await client.get(studio).header("authorization", unknown)).assertStatus(
			200,
		);
		(
			await client
				.get(studio)
				.header("authorization", `Bearer ${"a".repeat(10_000)}`)
		).assertStatus(200);

		assert.deepEqual(
			warn.mock.calls.map((call) => call.arguments),
			[[CALLER_WARNINGS.unknownKey]],
		);
		const logged = JSON.stringify(
			warn.mock.calls.map((call) => call.arguments),
		);
		assert.notInclude(logged, "qqqq");
	});

	test("a keyed call without a usable visitor spends the shared budget, and is warned about once", async ({
		client,
		assert,
	}) => {
		await studioWithOwner(SLUG);
		const warn = mock.method(logger, "warn", () => {});
		const { key, budget } = apiLimitFor("callerReads", {
			kind: "storefront",
			ip: null,
		});
		await limiter.use({ ...budget }).increment(key, budget.requests);

		for (const visitor of [
			undefined,
			"10.0.0.1",
			"::ffff:10.0.0.1",
			"203.0.113.5, 198.51.100.1",
			"203.0.113.5:80",
			["203.0.113.5", "198.51.100.1"],
		]) {
			const request = client
				.get(studio)
				.header("authorization", `Bearer ${ONE}`);
			if (visitor) request.header("x-visitor-ip", visitor);
			assertApiError(await request, 429, "rate_limited");
		}
		(
			await client
				.get(studio)
				.header("authorization", `Bearer ${ONE}`)
				.header("x-visitor-ip", "203.0.113.47")
		).assertStatus(200);
		assert.deepEqual(
			warn.mock.calls.map((call) => call.arguments),
			[[CALLER_WARNINGS.noVisitor]],
		);
	});

	test("a cacheable 200 carries no per-caller header", async ({
		client,
		assert,
	}) => {
		await studioWithOwner(SLUG);
		const response = await client
			.get(studio)
			.header("authorization", `Bearer ${ONE}`)
			.header("x-visitor-ip", "203.0.113.48");

		response.assertStatus(200);
		assert.match(response.header("cache-control") ?? "", /^public, /);
		for (const name of [
			"x-ratelimit-limit",
			"x-ratelimit-remaining",
			"x-ratelimit-reset",
			"retry-after",
		]) {
			assert.isUndefined(response.header(name), name);
		}
	});

	test("an address over its write budget is refused before its body is sent", async ({
		assert,
	}) => {
		await fillApiLimit("callerWrites", {
			kind: "anonymous",
			ip: "203.0.113.49",
		});
		const socket = await rawRequest([
			"POST /api/v1/__test/echo HTTP/1.1",
			"Content-Type: application/json",
			"Content-Length: 100000",
			"X-Forwarded-For: 203.0.113.49",
		]);
		try {
			const response = await readResponse(socket, 2000);
			assert.equal(response.status, 429);
			assert.equal(JSON.parse(response.body).error.code, "rate_limited");
			assert.isAbove(Number(response.headers["retry-after"]), 0);
		} finally {
			socket.destroy();
		}
	});

	test("a body the parser refuses is counted first, and over the budget it is never parsed", async ({
		client,
		assert,
	}) => {
		const ip = "203.0.113.53";
		const echo = () =>
			client.post("/api/v1/__test/echo").header("x-forwarded-for", ip);

		assertApiError(await echo().unsafeJson('{"label":'), 400, "bad_request");
		assertApiError(
			await echo().unsafeJson(`{"label":"${"x".repeat(1_100_000)}"}`),
			413,
			"payload_too_large",
		);
		const { key, budget } = apiLimitFor("callerWrites", {
			kind: "anonymous",
			ip,
		});
		assert.equal((await limiter.use({ ...budget }).get(key))?.consumed, 2);

		await fillApiLimit("callerWrites", { kind: "anonymous", ip });
		assertApiError(await echo().unsafeJson('{"label":'), 429, "rate_limited");
	});

	test("a refused upload writes no temp file", async ({ client, assert }) => {
		await studioWithOwner(SLUG);
		await fillApiLimit("callerWrites", {
			kind: "anonymous",
			ip: "203.0.113.50",
		});
		const before = await tempUploads();

		const response = await postInquiry(client, SLUG, intakeFields(), [
			await png(),
		]).header("x-forwarded-for", "203.0.113.50");
		await settle();

		assertApiError(response, 429, "rate_limited");
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("under its limits, a POST under an old slug is still the 404", async ({
		client,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		await inTenant(tenant, () =>
			new TenancyService().changeSlug(tenant, "limits-new-38"),
		);

		assertApiError(
			await postInquiry(client, SLUG, intakeFields()),
			404,
			"not_found",
		);
	});

	test("the dashboard never reads the key: signup still counts the connection's address", async ({
		client,
		assert,
	}) => {
		const signup = (visitor: string, body: Record<string, string>) =>
			client
				.post("/signup")
				.header("x-forwarded-for", "203.0.113.51")
				.header("authorization", `Bearer ${ONE}`)
				.header("x-visitor-ip", visitor)
				.header("referer", "/signup")
				.form(body)
				.withCsrfToken()
				.redirects(0);
		for (let i = 0; i < 10; i++) {
			(await signup(`198.51.100.${i + 1}`, {})).assertHeader(
				"location",
				"/signup",
			);
		}
		const refused = await signup("198.51.100.99", {
			fullName: "Ada Ink",
			email: "ada38@example.com",
			password: "secret-password",
			passwordConfirmation: "secret-password",
		});
		refused.assertFlashMessage(
			"error",
			"Too many attempts. Try again in 60 minutes.",
		);
		assert.isNull(await User.findBy("email", "ada38@example.com"));
	});

	test("an early refusal closes the connection instead of reading the rest", async ({
		assert,
	}) => {
		await fillApiLimit("callerWrites", {
			kind: "anonymous",
			ip: "203.0.113.52",
		});
		const socket = await rawRequest([
			"POST /api/v1/__test/echo HTTP/1.1",
			"Content-Type: application/json",
			"Content-Length: 100000",
			"X-Forwarded-For: 203.0.113.52",
		]);
		try {
			const response = await readResponse(socket, 2000);
			assert.equal(response.status, 429);
			assert.equal(response.headers.connection, "close");
			assert.isTrue(await closedWithin(socket, 1000));
		} finally {
			socket.destroy();
		}
	});
});
