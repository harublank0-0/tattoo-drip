import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { makeClient, makeInquiry } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

test.group("Inbox badge", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("owners get the new-inquiry count on every tenant page; artists get null", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			await makeInquiry(tenant, customer);
			await makeInquiry(tenant, customer);
			await makeInquiry(tenant, customer, {
				status: "declined",
				decidedAt: DateTime.utc(),
			});
		});

		const ownerProps = (
			await client.get("/t/black-needle/projects").withInertia().loginAs(owner)
		).inertiaProps;
		assert.equal(ownerProps.inboxCount, 2);

		const artistResponse = await client
			.get("/t/black-needle/projects")
			.withInertia()
			.loginAs(artist);
		artistResponse.assertStatus(200);
		assert.isNull(artistResponse.inertiaProps.inboxCount);
	});
});
