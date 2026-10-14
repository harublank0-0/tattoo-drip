import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import DepositService from "#modules/payments/services/deposit_service";
import {
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const deposits = new DepositService();

/** Decided as verified: the database wants a decision time with the status. */
const verified = () => ({
	status: "verified" as const,
	verifiedAt: DateTime.utc(),
});

/** A project with no quote or payments yet. */
const projectIn = (tenant: { id: string }) =>
	inTenant(tenant, async () =>
		makeProject(tenant, await makeClient(tenant), {
			status: "deposit_pending",
		}),
	);

test.group("DepositService.isSettled", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a project with no quote is not settled", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const project = await projectIn(tenant);

		assert.isFalse(
			await inTenant(tenant, () => deposits.isSettled(tenant, project)),
		);
	});

	test("a zero deposit is settled with no payments", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const project = await projectIn(tenant);

		await inTenant(tenant, async () => {
			await makeQuote(tenant, project, { depositAmount: 0 });
			assert.isTrue(await deposits.isSettled(tenant, project));
		});
	});

	test("only verified deposits count, and they must reach the amount", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const project = await projectIn(tenant);

		await inTenant(tenant, async () => {
			// The default quote asks for NPR 3,000 (300,000 paisa).
			await makeQuote(tenant, project);
			assert.isFalse(await deposits.isSettled(tenant, project), "unpaid");

			await makePayment(tenant, project);
			assert.isFalse(await deposits.isSettled(tenant, project), "submitted");

			await makePayment(tenant, project, {
				status: "rejected",
				verifiedAt: DateTime.utc(),
			});
			assert.isFalse(await deposits.isSettled(tenant, project), "rejected");

			await makePayment(tenant, project, { amount: 100_000, ...verified() });
			assert.isFalse(await deposits.isSettled(tenant, project), "partial");

			await makePayment(tenant, project, { amount: 200_000, ...verified() });
			assert.isTrue(await deposits.isSettled(tenant, project), "two parts");

			await makePayment(tenant, project, { amount: 50_000, ...verified() });
			assert.isTrue(await deposits.isSettled(tenant, project), "overpaid");
		});
	});

	test("a verified correction reverses a deposit; other kinds do not count", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const project = await projectIn(tenant);

		await inTenant(tenant, async () => {
			await makeQuote(tenant, project);
			await makePayment(tenant, project, { kind: "session", ...verified() });
			await makePayment(tenant, project, { kind: "balance", ...verified() });
			assert.isFalse(
				await deposits.isSettled(tenant, project),
				"session and balance payments are not the deposit",
			);

			await makePayment(tenant, project, verified());
			assert.isTrue(await deposits.isSettled(tenant, project), "deposit");

			await makePayment(tenant, project, {
				kind: "correction",
				amount: -300_000,
				...verified(),
			});
			assert.isFalse(
				await deposits.isSettled(tenant, project),
				"the correction un-settles it",
			);
		});
	});

	test("the current quote is the highest version", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const project = await projectIn(tenant);

		await inTenant(tenant, async () => {
			await makeQuote(tenant, project);
			await makePayment(tenant, project, verified());
			assert.isTrue(await deposits.isSettled(tenant, project), "v1 asks 3,000");

			await makeQuote(tenant, project, { version: 2, depositAmount: 500_000 });
			assert.isFalse(
				await deposits.isSettled(tenant, project),
				"v2 asks 5,000 and replaces v1",
			);

			await makeQuote(tenant, project, { version: 3, depositAmount: 300_000 });
			assert.isTrue(await deposits.isSettled(tenant, project), "v3 asks 3,000");
		});
	});

	test("another tenant cannot see the project's quote or payments", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		const project = await projectIn(a);
		await inTenant(a, () => makeQuote(a, project, { depositAmount: 0 }));

		assert.isTrue(await inTenant(a, () => deposits.isSettled(a, project)));
		assert.isFalse(await inTenant(b, () => deposits.isSettled(b, project)));
	});
});
