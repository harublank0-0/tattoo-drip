import { mock } from "node:test";
import { errors as limiterErrors } from "@adonisjs/limiter";
import limiter from "@adonisjs/limiter/services/main";
import { test } from "@japa/runner";
import { INTAKE_LIMITS } from "#modules/inquiries/intake_limits";
import { DEPOSIT_LIMITS } from "#modules/payments/deposit_limits";
import type { ApiCaller } from "#services/api_caller";
import {
	API_LIMITS,
	apiLimitFor,
	consumeApiLimit,
	SHARED_STOREFRONT_BUDGET,
} from "#services/api_limits";

const ANON: ApiCaller = { kind: "anonymous", ip: "203.0.113.7" };
const STOREFRONT: ApiCaller = { kind: "storefront", ip: "203.0.113.7" };
const NO_VISITOR: ApiCaller = { kind: "storefront", ip: null };

test.group("API limits: keys", () => {
	test("caller keys are digests, apart by kind and by limit", ({ assert }) => {
		const anon = apiLimitFor("callerReads", ANON);
		const storefront = apiLimitFor("callerReads", STOREFRONT);
		assert.match(anon.key, /^api_callerReads_anon_[A-Za-z0-9_-]{43}$/);
		assert.match(storefront.key, /^api_callerReads_sf_[A-Za-z0-9_-]{43}$/);
		assert.notInclude(anon.key, "203.0.113");
		assert.notEqual(anon.key, storefront.key);
		assert.notEqual(apiLimitFor("callerWrites", ANON).key, anon.key);
		assert.equal(
			apiLimitFor("callerReads", {
				kind: "anonymous",
				ip: "::ffff:203.0.113.7",
			}).key,
			anon.key,
		);
		assert.equal(
			apiLimitFor("callerReads", { kind: "anonymous", ip: "2001:db8:1:2::1" })
				.key,
			apiLimitFor("callerReads", { kind: "anonymous", ip: "2001:db8:1:2::9" })
				.key,
		);
		assert.deepEqual(anon.budget, API_LIMITS.callerReads.anonymous);
		assert.deepEqual(storefront.budget, API_LIMITS.callerReads.storefront);
	});

	test("a storefront call without a visitor spends one shared budget, reads and writes alike", ({
		assert,
	}) => {
		for (const name of ["callerReads", "callerWrites"] as const) {
			assert.deepEqual(apiLimitFor(name, NO_VISITOR), {
				key: "api_storefront_shared",
				budget: SHARED_STOREFRONT_BUDGET,
			});
		}
	});

	test("studio limits count per studio and per kind, and need the studio", ({
		assert,
	}) => {
		assert.equal(
			apiLimitFor("tenantReads", ANON, "t-a").key,
			"api_tenantReads_anon_t-a",
		);
		assert.equal(
			apiLimitFor("tenantReads", STOREFRONT, "t-a").key,
			"api_tenantReads_sf_t-a",
		);
		assert.equal(
			apiLimitFor("tenantReads", NO_VISITOR, "t-a").key,
			"api_tenantReads_sf_t-a",
		);
		assert.notEqual(
			apiLimitFor("tenantReads", ANON, "t-b").key,
			"api_tenantReads_anon_t-a",
		);
		assert.deepEqual(
			apiLimitFor("tenantReads", STOREFRONT, "t-a").budget,
			API_LIMITS.tenantReads.storefront,
		);
		assert.throws(() => apiLimitFor("tenantReads", ANON), /per tenant/);
	});

	test("the numbers, and the generic limits never bind before a route's own", ({
		assert,
	}) => {
		assert.deepEqual(API_LIMITS.callerReads.anonymous, {
			requests: 300,
			duration: "5 mins",
		});
		assert.deepEqual(API_LIMITS.callerWrites.anonymous, {
			requests: 60,
			duration: "1 hour",
		});
		assert.deepEqual(API_LIMITS.tenantReads.storefront, {
			requests: 6000,
			duration: "5 mins",
		});
		assert.deepEqual(API_LIMITS.tenantReads.anonymous, {
			requests: 1500,
			duration: "5 mins",
		});
		assert.deepEqual(SHARED_STOREFRONT_BUDGET, {
			requests: 3000,
			duration: "5 mins",
		});
		assert.isAbove(
			API_LIMITS.callerWrites.anonymous.requests,
			DEPOSIT_LIMITS.submit.perAddress.requests,
		);
		assert.isAbove(
			API_LIMITS.callerWrites.anonymous.requests,
			INTAKE_LIMITS.perAddress.requests,
		);
		// 300 per 5 minutes is 600 per 10: above the deposit page's 120 per address.
		assert.isAbove(
			API_LIMITS.callerReads.anonymous.requests * 2,
			DEPOSIT_LIMITS.read.perAddress.requests,
		);
	});
});

test.group("API limits: windows", (group) => {
	group.each.setup(() => limiter.clear(["memory"]));
	group.each.teardown(() => mock.timers.reset());

	for (const [name, tenantId, minutes] of [
		["callerReads", undefined, 6],
		["callerWrites", undefined, 61],
		["tenantReads", "tenant-38", 6],
	] as const) {
		test(`${name}: refused over its budget until the window ends`, async ({
			assert,
		}) => {
			mock.timers.enable({ apis: ["Date"], now: Date.now() });
			const { budget } = apiLimitFor(name, ANON, tenantId);
			for (let i = 0; i < budget.requests; i++) {
				await consumeApiLimit(name, ANON, tenantId);
			}
			await assert.rejects(
				() => consumeApiLimit(name, ANON, tenantId),
				limiterErrors.E_TOO_MANY_REQUESTS,
			);
			// The other kind is untouched.
			await consumeApiLimit(name, STOREFRONT, tenantId);
			const other: ApiCaller = { kind: "anonymous", ip: "198.51.100.9" };
			if (tenantId) {
				// A studio's budget is shared by every anonymous caller; another studio's is not.
				await assert.rejects(
					() => consumeApiLimit(name, other, tenantId),
					limiterErrors.E_TOO_MANY_REQUESTS,
				);
				await consumeApiLimit(name, ANON, "tenant-other-38");
			} else {
				// Another caller is untouched.
				await consumeApiLimit(name, other);
			}

			mock.timers.tick(minutes * 60 * 1000);
			await consumeApiLimit(name, ANON, tenantId);
		});
	}
});
