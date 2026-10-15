import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import ClientService from "#modules/clients/services/client_service";
import { makeClient } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const clients = new ClientService();

test.group("ClientService.findMany", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("returns the tenant's live clients among the ids", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const sita = await makeClient(tenant, { name: "Sita" });
			const ram = await makeClient(tenant, { name: "Ram" });
			const gone = await makeClient(tenant, { name: "Gone" });
			await makeClient(tenant, { name: "Not asked for" });
			await gone.softDelete();

			const found = await clients.findMany(tenant, [sita.id, ram.id, gone.id]);
			assert.sameMembers(
				found.map(({ name }) => name),
				["Sita", "Ram"],
			);
			assert.deepEqual(await clients.findMany(tenant, []), []);
		});
	});

	test("another tenant's ids find nothing", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		const theirs = await inTenant(a, () => makeClient(a));

		assert.deepEqual(
			await inTenant(b, () => clients.findMany(b, [theirs.id])),
			[],
		);
	});
});
