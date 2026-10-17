import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { assertPublicIsolation } from "#tests/helpers/public_isolation";
import { twoStudios } from "#tests/helpers/tenants";
import { publicIsolationCases } from "#tests/isolation/public_cases";
import { publicLeaks } from "#tests/support/test_routes";

test.group("Public API isolation", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	for (const isolationCase of publicIsolationCases) {
		test(`${isolationCase.method} ${isolationCase.pattern}`, async ({
			client,
			assert,
		}) => {
			await assertPublicIsolation(
				client,
				assert,
				await twoStudios(),
				isolationCase,
			);
		});
	}
});

test.group("Public isolation harness catches what it should", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => publicLeaks.clear());

	const leak = {
		method: "GET" as const,
		pattern: "/api/v1/tenants/:tenant/__test/leak",
		ownStatus: 200 as const,
		ownMarkers: (own: { tenant: { slug: string } }) => [own.tenant.slug],
		snapshot: async () => null,
	};

	test("a route that answers A's path with B's data is reported", async ({
		client,
		assert,
	}) => {
		const studios = await twoStudios();
		publicLeaks.set(studios.a.tenant.id, studios.b.tenant.name);

		await assert.rejects(
			() => assertPublicIsolation(client, assert, studios, leak),
			/mentions studio B/,
		);
	});

	test("a positive control that A's answer doesn't meet is reported", async ({
		client,
		assert,
	}) => {
		await assert.rejects(
			async () =>
				assertPublicIsolation(client, assert, await twoStudios(), {
					...leak,
					ownMarkers: () => ["not-in-the-answer"],
				}),
			/mentions A/,
		);
	});
});
