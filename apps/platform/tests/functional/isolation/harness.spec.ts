import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { assertCrossTenantIsolation } from "#tests/helpers/isolation";
import { twoStudios } from "#tests/helpers/tenants";
import { type IsolationCase, isolationCases } from "#tests/isolation/cases";

function caseFor(method: IsolationCase["method"], pattern: string) {
	const found = isolationCases.find(
		(entry) => entry.method === method && entry.pattern === pattern,
	);
	if (!found) throw new Error(`no isolation case for ${method} ${pattern}`);
	return found;
}

test.group("Isolation harness catches what it should", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

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
		let reads = 0;

		await assert.rejects(
			async () =>
				assertCrossTenantIsolation(client, assert, await twoStudios(), {
					...profile,
					snapshot: async () => ++reads,
				}),
			/changed studio B/,
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
		assert.lengthOf(methods, 2);
	});
});
