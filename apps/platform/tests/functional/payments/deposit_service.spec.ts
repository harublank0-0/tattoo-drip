import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import DepositService from "#modules/payments/services/deposit_service";
import QuoteService from "#modules/projects/services/quote_service";
import {
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const deposits = new DepositService(new QuoteService());

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

			const deposit = await makePayment(tenant, project, verified());
			assert.isTrue(await deposits.isSettled(tenant, project), "deposit");

			await makePayment(tenant, project, {
				kind: "correction",
				amount: -300_000,
				correctsPaymentId: deposit.id,
				...verified(),
			});
			assert.isFalse(
				await deposits.isSettled(tenant, project),
				"the correction un-settles it",
			);
		});
	});

	test("only payments in the quote's currency count", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const project = await projectIn(tenant);

		await inTenant(tenant, async () => {
			// A USD 100 deposit (10,000 cents); NPR 3,000 is 300,000 paisa, a bigger
			// number that is not worth USD 100.
			await makeQuote(tenant, project, {
				currency: "USD",
				depositAmount: 10_000,
			});
			await makePayment(tenant, project, verified());
			assert.isFalse(
				await deposits.isSettled(tenant, project),
				"NPR paisa do not pay a USD quote",
			);

			await makePayment(tenant, project, {
				amount: 10_000,
				currency: "USD",
				...verified(),
			});
			assert.isTrue(
				await deposits.isSettled(tenant, project),
				"a USD payment does",
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

test.group("DepositService.verifiedPaid", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("sums the verified deposits and corrections in the currency", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const project = await projectIn(tenant);

		await inTenant(tenant, async () => {
			assert.equal(await deposits.verifiedPaid(tenant, project, "NPR"), 0);

			await makePayment(tenant, project, { amount: 100_000, ...verified() });
			const second = await makePayment(tenant, project, {
				amount: 50_000,
				...verified(),
			});
			await makePayment(tenant, project, {
				kind: "correction",
				amount: -20_000,
				correctsPaymentId: second.id,
				...verified(),
			});
			// Not counted: unverified, another currency, other kinds.
			await makePayment(tenant, project, { amount: 900_000 });
			await makePayment(tenant, project, {
				amount: 10_000,
				currency: "USD",
				...verified(),
			});
			await makePayment(tenant, project, { kind: "session", ...verified() });

			assert.equal(
				await deposits.verifiedPaid(tenant, project, "NPR"),
				130_000,
			);
			assert.equal(await deposits.verifiedPaid(tenant, project, "USD"), 10_000);
		});
	});
});

test.group(
	"DepositService: corrections count only for deposits (TAT-66)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("the refund-and-reversal case does not settle a bigger deposit", async ({
			assert,
		}) => {
			const { tenant } = await studioWithOwner();
			const project = await projectIn(tenant);

			await inTenant(tenant, async () => {
				// The quote asks NPR 6,000; the client paid NPR 3,000. A refund was
				// recorded by mistake and then reversed: the studio holds NPR 3,000.
				await makeQuote(tenant, project, { depositAmount: 600_000 });
				await makePayment(tenant, project, verified());
				const refund = await makePayment(tenant, project, {
					kind: "refund",
					amount: -300_000,
					...verified(),
				});
				await makePayment(tenant, project, {
					kind: "correction",
					amount: 300_000,
					correctsPaymentId: refund.id,
					...verified(),
				});

				assert.equal(
					await deposits.verifiedPaid(tenant, project, "NPR"),
					300_000,
				);
				assert.isFalse(await deposits.isSettled(tenant, project));
			});
		});

		test("reversing a session payment doesn't touch the deposit", async ({
			assert,
		}) => {
			const { tenant } = await studioWithOwner();
			const project = await projectIn(tenant);

			await inTenant(tenant, async () => {
				await makeQuote(tenant, project);
				await makePayment(tenant, project, verified());
				const session = await makePayment(tenant, project, {
					kind: "session",
					...verified(),
				});
				await makePayment(tenant, project, {
					kind: "correction",
					amount: -300_000,
					correctsPaymentId: session.id,
					...verified(),
				});

				assert.isTrue(await deposits.isSettled(tenant, project));
			});
		});
	},
);

test.group("DepositService.expirySpared", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a waiting screenshot, or a deposit verified, rejected or reversed after the expiry, spares; nothing else does", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const expiresAt = DateTime.utc().minus({ hours: 1 });
		const spared = (project: { id: string }) =>
			inTenant(tenant, () =>
				deposits.expirySpared(tenant, project, { expiresAt }),
			);

		const waiting = await projectIn(tenant);
		const lateNo = await projectIn(tenant);
		const earlyNo = await projectIn(tenant);
		const reversedLate = await projectIn(tenant);
		const plain = await projectIn(tenant);
		const takenLate = await projectIn(tenant);
		const takenEarly = await projectIn(tenant);
		await inTenant(tenant, async () => {
			await makePayment(tenant, takenLate, {
				amount: 100_000,
				...verified(),
			});
			await makePayment(tenant, takenEarly, {
				amount: 100_000,
				status: "verified",
				verifiedAt: expiresAt.minus({ hours: 1 }),
			});
			await makePayment(tenant, waiting);
			await makePayment(tenant, lateNo, {
				status: "rejected",
				verifiedAt: DateTime.utc(),
			});
			await makePayment(tenant, earlyNo, {
				status: "rejected",
				verifiedAt: expiresAt.minus({ hours: 1 }),
			});
			const deposit = await makePayment(tenant, reversedLate, {
				status: "verified",
				verifiedAt: expiresAt.minus({ hours: 2 }),
			});
			await makePayment(tenant, reversedLate, {
				kind: "correction",
				amount: -300_000,
				correctsPaymentId: deposit.id,
				...verified(),
			});
			await makePayment(tenant, plain, { kind: "session", ...verified() });
		});

		assert.isTrue(await spared(waiting), "a screenshot waits");
		assert.isTrue(await spared(lateNo), "rejected after the expiry");
		assert.isFalse(await spared(earlyNo), "rejected before the expiry");
		assert.isTrue(await spared(reversedLate), "reversed after the expiry");
		assert.isFalse(await spared(plain), "nothing about the deposit");
		assert.isTrue(await spared(takenLate), "verified or recorded after");
		assert.isFalse(await spared(takenEarly), "verified before the expiry");
	});

	test("another studio's context sees none of it", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("spared-a-66", "A");
		const { tenant: b } = await studioWithOwner("spared-b-66", "B");
		const project = await projectIn(a);
		await inTenant(a, () => makePayment(a, project));

		assert.isFalse(
			await inTenant(b, () =>
				deposits.expirySpared(a, project, { expiresAt: DateTime.utc() }),
			),
		);
	});
});
