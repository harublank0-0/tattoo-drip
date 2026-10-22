import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { depositSettled } from "#modules/payments/ledger";
import { expiryCancels } from "#modules/projects/expiry";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import { depositServices } from "#tests/helpers/deposits";
import {
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const { projects } = depositServices();

/** What the expiry sweep does and what Today's rule says must be the same answer (TAT-107 fix 2). */
test.group("The expiry sweep and Today share one rule", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const CASES: {
		name: string;
		status: ProjectStatus;
		depositAmount: number;
		paid: number;
	}[] = [
		{
			name: "deposit_pending, nothing paid",
			status: "deposit_pending",
			depositAmount: 300_000,
			paid: 0,
		},
		{
			name: "deposit_pending, half paid",
			status: "deposit_pending",
			depositAmount: 300_000,
			paid: 150_000,
		},
		{
			name: "deposit_pending, fully paid",
			status: "deposit_pending",
			depositAmount: 300_000,
			paid: 300_000,
		},
		{
			name: "deposit_pending, zero deposit",
			status: "deposit_pending",
			depositAmount: 0,
			paid: 0,
		},
		{
			name: "quoted, nothing paid",
			status: "quoted",
			depositAmount: 300_000,
			paid: 0,
		},
		{
			name: "quoted, fully paid",
			status: "quoted",
			depositAmount: 300_000,
			paid: 300_000,
		},
		{
			name: "quoted, zero deposit",
			status: "quoted",
			depositAmount: 0,
			paid: 0,
		},
		{
			name: "on_hold, fully paid",
			status: "on_hold",
			depositAmount: 300_000,
			paid: 300_000,
		},
		{
			name: "on_hold, nothing paid",
			status: "on_hold",
			depositAmount: 300_000,
			paid: 0,
		},
	];

	test("expireQuote cancels exactly the projects expiryCancels says it does", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("expiry-agree-107");
		for (const { name, status, depositAmount, paid } of CASES) {
			const { project, quote, payments } = await inTenant(tenant, async () => {
				const project = await makeProject(tenant, await makeClient(tenant), {
					status,
				});
				const quote = await makeQuote(tenant, project, {
					depositAmount,
					expiresAt: DateTime.utc().minus({ hours: 1 }),
				});
				const payments = paid
					? [
							await makePayment(tenant, project, {
								amount: paid,
								status: "verified",
								verifiedAt: DateTime.utc().minus({ days: 2 }),
							}),
						]
					: [];
				return { project, quote, payments };
			});
			const expected = expiryCancels({
				status,
				depositAmount,
				depositSettled: depositSettled(quote, payments),
			});

			const cancelled = await inTenant(tenant, () =>
				projects.expireQuote(tenant, project.id, quote.id),
			);

			assert.equal(cancelled, expected, name);
			const after = await inTenant(tenant, () =>
				TattooProject.findOrFail(project.id),
			);
			assert.equal(after.status, expected ? "cancelled" : status, name);
		}
	});
});
