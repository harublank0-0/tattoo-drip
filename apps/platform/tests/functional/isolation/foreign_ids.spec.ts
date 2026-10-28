import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { caseRequest } from "#tests/helpers/isolation";
import { twoStudios } from "#tests/helpers/tenants";
import { isolationCases } from "#tests/isolation/cases";

/**
 * What a studio's own pages carry (TAT-16): every file key of studio A, signed or public, starts
 * with `tenants/<A's id>/`, so a page of studio B that holds no trace of A's id holds no file URL,
 * link or key of A either. The cross-tenant spec proves the attack requests fail; this proves the
 * positive control's pages, which the owner of B opens every day, leak nothing of A.
 */
test.group("Another studio's id is never in a page (TAT-16)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	for (const isolationCase of isolationCases) {
		if (isolationCase.method !== "GET") continue;
		test(`${isolationCase.pattern} as studio B's owner names nothing of studio A`, async ({
			client,
			assert,
		}) => {
			const { a, b } = await twoStudios();

			const response = await caseRequest(client, isolationCase, b, b, b.owner);

			response.assertStatus(isolationCase.ownStatus);
			const text = response.text();
			assert.notInclude(text, a.tenant.id);
			assert.notInclude(text, a.tenant.slug);
		});
	}
});
