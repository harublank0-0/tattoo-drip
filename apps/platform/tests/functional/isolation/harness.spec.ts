import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { assertCrossTenantIsolation } from "#tests/helpers/isolation";
import { twoStudios } from "#tests/helpers/tenants";
import { type IsolationCase, isolationCases } from "#tests/isolation/cases";
import { collateralTargets, idorOwners } from "#tests/support/test_routes";

function caseFor(method: IsolationCase["method"], pattern: string) {
	const found = isolationCases.find(
		(entry) => entry.method === method && entry.pattern === pattern,
	);
	if (!found) throw new Error(`no isolation case for ${method} ${pattern}`);
	return found;
}

test.group("Isolation harness catches what it should", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => {
		idorOwners.clear();
		collateralTargets.clear();
	});

	test("a route that answers a foreign studio's slug is reported", async ({
		client,
		assert,
	}) => {
		const leaky: IsolationCase = {
			method: "GET",
			pattern: "/__test/leak/:tenant",
			actor: "owner",
			ownStatus: 200,
			snapshot: async () => null,
		};

		await assert.rejects(
			async () =>
				assertCrossTenantIsolation(client, assert, await twoStudios(), leaky),
			/expected 200 to equal 404/,
		);
	});

	test("a route that trusts another studio's :id under the caller's own slug is reported", async ({
		client,
		assert,
	}) => {
		const studios = await twoStudios();
		const { a, b } = studios;
		idorOwners.set(a.paymentMethod.id, a.tenant.id);
		idorOwners.set(b.paymentMethod.id, b.tenant.id);
		const idor: IsolationCase = {
			method: "DELETE",
			pattern: "/__test/idor/:tenant/payment-methods/:id",
			resource: "paymentMethod",
			actor: "owner",
			ownStatus: 200,
			snapshot: caseFor("DELETE", "/t/:tenant/settings/payments/:id").snapshot,
		};

		// The route checks the slug, so the first attack gets its 404 and only
		// the second attack (A's slug, B's id) can report the leak.
		const wrongSlug = await client
			.delete(
				`/__test/idor/${b.tenant.slug}/payment-methods/${b.paymentMethod.id}`,
			)
			.withCsrfToken()
			.loginAs(a.owner)
			.redirects(0);
		wrongSlug.assertStatus(404);

		await assert.rejects(
			async () => assertCrossTenantIsolation(client, assert, studios, idor),
			/expected 200 to equal 404/,
		);
	});

	test("a valid request of studio A that also writes to studio B is reported", async ({
		client,
		assert,
	}) => {
		const studios = await twoStudios();
		const { a, b } = studios;
		collateralTargets.set(a.tenant.id, {
			tenantId: b.tenant.id,
			methodId: b.paymentMethod.id,
		});
		const collateral: IsolationCase = {
			method: "DELETE",
			pattern: "/__test/collateral/:tenant/payment-methods/:id",
			resource: "paymentMethod",
			actor: "owner",
			ownStatus: 200,
			snapshot: caseFor("DELETE", "/t/:tenant/settings/payments/:id").snapshot,
		};

		await assert.rejects(
			async () =>
				assertCrossTenantIsolation(client, assert, studios, collateral),
			/A's own valid request changed studio B/,
		);
	});

	test("a case with an :id and no resource is refused instead of guessing one", async ({
		client,
		assert,
	}) => {
		const remove = caseFor("DELETE", "/t/:tenant/settings/payments/:id");

		await assert.rejects(
			async () =>
				assertCrossTenantIsolation(client, assert, await twoStudios(), {
					...remove,
					resource: undefined,
				}),
			/has an :id but its isolation case names no `resource`/,
		);
	});

	test("the positive control fails for a wrong actor instead of passing vacuously", async ({
		client,
		assert,
	}) => {
		const profile = caseFor("GET", "/t/:tenant/settings/profile");

		await assert.rejects(
			async () =>
				assertCrossTenantIsolation(client, assert, await twoStudios(), {
					...profile,
					actor: "artist",
				}),
			/expected 404 to equal 200/,
		);
	});

	test("a write whose snapshot cannot see the change is reported", async ({
		client,
		assert,
	}) => {
		const deposits = caseFor("PUT", "/t/:tenant/settings/deposits");

		await assert.rejects(
			async () =>
				assertCrossTenantIsolation(client, assert, await twoStudios(), {
					...deposits,
					snapshot: async () => null,
				}),
			/did not change studio A's snapshot/,
		);
	});

	test("a snapshot that moves during an attack is reported as a change to studio B", async ({
		client,
		assert,
	}) => {
		const profile = caseFor("GET", "/t/:tenant/settings/profile");
		// The first two reads (before the control, right after it) agree; the
		// third, after the attack, differs.
		let reads = 0;

		await assert.rejects(
			async () =>
				assertCrossTenantIsolation(client, assert, await twoStudios(), {
					...profile,
					snapshot: async () => (++reads > 2 ? "moved" : "steady"),
				}),
			/GET \/t\/studio-b\/settings\/profile changed studio B/,
		);
	});

	test("the snapshots read real rows of studio B", async ({ assert }) => {
		const { b } = await twoStudios();

		for (const { method, pattern, snapshot } of isolationCases) {
			const state = await snapshot(b);
			const label = `${method} ${pattern}`;
			// Only pages that read nothing may snapshot nothing.
			if (method !== "GET") assert.isNotNull(state, label);
			if (state !== null) assert.isNotEmpty(state, label);
		}
		const methods = (await caseFor(
			"GET",
			"/t/:tenant/settings/payments",
		).snapshot(b)) as unknown[];
		// Two cash methods, and the eSewa method the deposit page shows (TAT-65).
		assert.lengthOf(methods, 3);
	});
});
