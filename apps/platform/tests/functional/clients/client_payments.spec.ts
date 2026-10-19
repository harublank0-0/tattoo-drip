import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const SLUG = "client-pay-66";
const verified = () => ({
	status: "verified" as const,
	verifiedAt: DateTime.utc(),
});

test.group("Payments on the client profile", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists the client's payments newest first and the balance due of their open projects", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
		const { sita, booked, deposit, refund } = await inTenant(
			tenant,
			async () => {
				const sita = await makeClient(tenant, { name: "Sita Rai" });
				const booked = await makeProject(tenant, sita, { status: "booked" });
				await makeQuote(tenant, booked);
				const deposit = await makePayment(tenant, booked, verified());
				// A cancelled project's balance is not owed; its refund is listed.
				const cancelled = await makeProject(tenant, sita, {
					status: "cancelled",
				});
				await makeQuote(tenant, cancelled);
				const refund = await makePayment(tenant, cancelled, {
					kind: "refund",
					amount: -100_000,
					...verified(),
				});
				// Another client's payment never shows here.
				const ram = await makeClient(tenant, { name: "Ram" });
				const theirs = await makeProject(tenant, ram, { status: "booked" });
				await makePayment(tenant, theirs, verified());
				return { sita, booked, deposit, refund };
			},
		);

		const props = (
			await client
				.get(`/t/${SLUG}/clients/${sita.id}`)
				.withInertia()
				.loginAs(owner)
		).inertiaProps;

		assert.equal(props.payments.balanceDueText, "NPR 12,000");
		assert.deepEqual(
			props.payments.rows.map(({ id }: { id: string }) => id),
			[refund.id, deposit.id],
		);
		assert.deepInclude(props.payments.rows[1], {
			projectId: booked.id,
			projectBrief: "A small fine-line moth on the forearm",
			kind: "deposit",
			amountText: "NPR 3,000",
			status: "verified",
		});
		assert.equal(props.payments.rows[0].amountText, "−NPR 1,000");
	});

	test("nothing due and no payments read as such", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
		const quiet = await inTenant(tenant, () => makeClient(tenant));

		const props = (
			await client
				.get(`/t/${SLUG}/clients/${quiet.id}`)
				.withInertia()
				.loginAs(owner)
		).inertiaProps;

		assert.deepEqual(props.payments, { balanceDueText: null, rows: [] });
	});
});
