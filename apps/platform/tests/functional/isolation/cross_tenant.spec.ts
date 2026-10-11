import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { assertCrossTenantIsolation } from "#tests/helpers/isolation";
import { twoStudios } from "#tests/helpers/tenants";
import { isolationCases } from "#tests/isolation/cases";

test.group("Cross-tenant isolation", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	for (const isolationCase of isolationCases) {
		test(`${isolationCase.method} ${isolationCase.pattern}`, async ({
			client,
			assert,
		}) => {
			await assertCrossTenantIsolation(
				client,
				assert,
				await twoStudios(),
				isolationCase,
			);
		});
	}
});
