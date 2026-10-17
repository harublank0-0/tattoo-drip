import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { makeClient, makeInquiry, makeProject } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const clientsUrl = (path = "") => `/t/black-needle/clients${path}`;

test.group("Clients list", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sees clients newest first with their counts and activity", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, async () => {
			const sita = await makeClient(tenant, {
				name: "Sita Rai",
				phone: "+9779812345678",
			});
			await makeProject(tenant, sita);
			await makeProject(tenant, sita);
			const ram = await makeClient(tenant, { name: "Ram Thapa" });
			await makeInquiry(tenant, ram);
		});

		const response = await client
			.get(clientsUrl())
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("clients/index");
		const props = response.inertiaProps;
		assert.equal(props.search, "");
		assert.deepEqual(props.page, { current: 1, last: 1, total: 2 });
		assert.deepEqual(
			props.clients.map(({ name }: { name: string }) => name),
			["Ram Thapa", "Sita Rai"],
		);
		assert.deepInclude(props.clients[1], {
			name: "Sita Rai",
			phone: "+9779812345678",
			projects: 2,
			lastActivityText: "today",
		});
		assert.equal(props.clients[0].projects, 0);
	});

	test("?q= searches by name or phone", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, async () => {
			await makeClient(tenant, { name: "Sita Rai", phone: "+9779812345678" });
			await makeClient(tenant, { name: "Ram Thapa" });
		});

		const byName = (
			await client.get(clientsUrl("?q=rai")).withInertia().loginAs(owner)
		).inertiaProps;
		assert.equal(byName.search, "rai");
		assert.deepEqual(
			byName.clients.map(({ name }: { name: string }) => name),
			["Sita Rai"],
		);

		const byPhone = (
			await client.get(clientsUrl("?q=981-234")).withInertia().loginAs(owner)
		).inertiaProps;
		assert.deepEqual(
			byPhone.clients.map(({ name }: { name: string }) => name),
			["Sita Rai"],
		);
	});

	test("artists get a 404", async ({ client }) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);

		const response = await client
			.get(clientsUrl())
			.withInertia()
			.loginAs(artist);
		response.assertStatus(404);
	});
});
