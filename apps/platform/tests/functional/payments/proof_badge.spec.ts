import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { makeClient, makePayment, makeProject } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const SLUG = "badge-needle-65";

test.group("Projects badge", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("owners get the number of deposit proofs to check on every tenant page; artists get null", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG);
		const artist = await artistIn(tenant, `artist@${SLUG}.example`);
		await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			const one = await makeProject(tenant, customer, {
				status: "deposit_pending",
			});
			const two = await makeProject(tenant, customer, {
				status: "deposit_pending",
			});
			await makePayment(tenant, one);
			await makePayment(tenant, two);
			await makePayment(tenant, two, { kind: "session" });
			await makePayment(tenant, one, {
				status: "rejected",
				verifiedAt: DateTime.utc(),
			});
		});

		const ownerProps = (
			await client.get(`/t/${SLUG}/projects`).withInertia().loginAs(owner)
		).inertiaProps;
		assert.equal(ownerProps.proofCount, 2);

		const artistResponse = await client
			.get(`/t/${SLUG}/projects`)
			.withInertia()
			.loginAs(artist);
		artistResponse.assertStatus(200);
		assert.isNull(artistResponse.inertiaProps.proofCount);
	});
});
