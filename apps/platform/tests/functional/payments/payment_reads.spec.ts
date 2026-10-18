import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import {
	ownerMember,
	paymentServices,
	proofFor,
} from "#tests/helpers/payments";
import {
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const { payments } = paymentServices();

const verified = () => ({
	status: "verified" as const,
	verifiedAt: DateTime.utc(),
});

test.group("PaymentService reads", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("forProjects lists the payments of these projects, newest first; balancesFor gives each its balance", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("reads-many-66", "Black Needle");
		const { one, two, direct, rows } = await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const one = await makeProject(tenant, client, { status: "booked" });
			await makeQuote(tenant, one);
			const two = await makeProject(tenant, client, { status: "booked" });
			await makeQuote(tenant, two, { fixedPrice: 1_000_000, depositAmount: 0 });
			const direct = await makeProject(tenant, client, { status: "booked" });
			const first = await makePayment(tenant, one, verified());
			const second = await makePayment(tenant, two, {
				kind: "balance",
				amount: 400_000,
				...verified(),
			});
			return { one, two, direct, rows: [first, second] };
		});

		const listed = await inTenant(tenant, () =>
			payments.forProjects(tenant, [one.id, two.id, direct.id]),
		);
		assert.deepEqual(
			listed.map(({ id }) => id),
			[rows[1].id, rows[0].id],
		);
		const balances = await inTenant(tenant, () =>
			payments.balancesFor(tenant, [one, two, direct]),
		);
		assert.equal(balances.get(one.id)?.due, 1_200_000n);
		assert.equal(balances.get(two.id)?.due, 600_000n);
		assert.isNull(balances.get(direct.id)?.due);
		assert.deepEqual(
			await inTenant(tenant, () => payments.forProjects(tenant, [])),
			[],
		);
	});

	test("listFlags: a screenshot to check, and a closed project's deposit to settle", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(
			"reads-flags-66",
			"Black Needle",
		);
		const projects = await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const waiting = await makeProject(tenant, client, {
				status: "deposit_pending",
			});
			await makeQuote(tenant, waiting);
			await proofFor(tenant, waiting);
			const closed = await makeProject(tenant, client, { status: "cancelled" });
			await makeQuote(tenant, closed);
			await makePayment(tenant, closed, verified());
			const settled = await makeProject(tenant, client, {
				status: "cancelled",
			});
			await makeQuote(tenant, settled);
			await makePayment(tenant, settled, verified());
			const open = await makeProject(tenant, client, { status: "booked" });
			await makeQuote(tenant, open);
			await makePayment(tenant, open, verified());
			return { waiting, closed, settled, open };
		});
		await inTenant(tenant, () =>
			payments.recordOutcome(tenant, ownerMember(owner), projects.settled, {
				outcome: "kept",
				note: null,
			}),
		);

		const flags = await inTenant(tenant, () =>
			payments.listFlags(tenant, Object.values(projects)),
		);

		assert.deepEqual(flags.get(projects.waiting.id), {
			proofWaiting: true,
			depositToSettle: false,
		});
		assert.deepEqual(flags.get(projects.closed.id), {
			proofWaiting: false,
			depositToSettle: true,
		});
		assert.deepEqual(flags.get(projects.settled.id), {
			proofWaiting: false,
			depositToSettle: false,
		});
		assert.deepEqual(flags.get(projects.open.id), {
			proofWaiting: false,
			depositToSettle: false,
		});
	});

	test("memberNames: the full name, else the email", async ({ assert }) => {
		const named = await User.create({
			fullName: "Asha Rai",
			email: "asha-66@example.com",
			password: "secret-password",
		});
		const bare = await User.create({
			email: "bare-66@example.com",
			password: "secret-password",
		});

		const names = await payments.memberNames([
			named.id,
			bare.id,
			null,
			named.id,
		]);

		assert.deepEqual(Object.fromEntries(names), {
			[named.id]: "Asha Rai",
			[bare.id]: "bare-66@example.com",
		});
	});

	test("another studio's context sees none of a project's money", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("reads-a-66", "A");
		const { tenant: b } = await studioWithOwner("reads-b-66", "B");
		const project = await inTenant(a, async () => {
			const made = await makeProject(a, await makeClient(a), {
				status: "booked",
			});
			await makeQuote(a, made);
			await makePayment(a, made, verified());
			return made;
		});

		const seen = await inTenant(b, () => payments.forProject(a, project));
		assert.isNull(seen.quote);
		assert.lengthOf(seen.payments, 0);
		assert.lengthOf(
			await inTenant(b, () => payments.forProjects(a, [project.id])),
			0,
		);
	});
});
