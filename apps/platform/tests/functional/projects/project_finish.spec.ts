import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type Artist from "#modules/artists/models/artist";
import { ProjectRuleError } from "#modules/projects/errors";
import { healingCheckDueOn } from "#modules/projects/finish";
import TattooProject, {
	PROJECT_STATUSES,
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import type Tenant from "#modules/tenancy/models/tenant";
import { ownerMember, paymentServices } from "#tests/helpers/payments";
import {
	makeArtist,
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const { projects, payments, sessions } = paymentServices();

const SLUG = "finish-needle-111";

const statusOf = async (project: TattooProject) =>
	(await TattooProject.findOrFail(project.id)).status;

/** The ProjectRuleError reason `fn` throws, or null when it succeeds. */
async function ruleOf(fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (error) {
		if (error instanceof ProjectRuleError) return error.reason;
		throw error;
	}
	return null;
}

/** A verified payment's decision columns (the database checks they agree). */
const verified = (owner: { id: string }) => ({
	status: "verified" as const,
	verifiedAt: DateTime.utc(),
	verifiedByUserId: owner.id,
});

/** A studio with its owner (as a member) and the artist profile Sita. */
async function setup() {
	const { owner, tenant } = await studioWithOwner(SLUG, "Finish Needle");
	const sita = await inTenant(tenant, () => makeArtist(tenant));
	return { owner, tenant, sita, OWNER: ownerMember(owner) };
}

/**
 * A project in `status` assigned to Sita whose two-hour tattoo session
 * ended `daysAgo` days ago. Give each project of a test its own day: Sita's
 * done sessions keep their time. Call it inside inTenant.
 */
async function workDone(
	tenant: Tenant,
	sita: Artist,
	status: ProjectStatus = "in_progress",
	daysAgo = 7,
) {
	const project = await makeProject(tenant, await makeClient(tenant), {
		status,
		artistId: sita.id,
	});
	const endsAt = DateTime.utc().minus({ days: daysAgo }).startOf("hour");
	await makeSession(tenant, project, sita, {
		startsAt: endsAt.minus({ hours: 2 }),
		endsAt,
		status: "completed",
	});
	return project;
}

test.group("ProjectService: finishing a project (TAT-111)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner finishes the tattoo into its healing check, then completes it", async ({
		assert,
	}) => {
		const { tenant, sita, OWNER } = await setup();
		await inTenant(tenant, async () => {
			const project = await workDone(tenant, sita);
			const dueOn = healingCheckDueOn(
				await sessions.listForProject(tenant, project),
				tenant.timezone,
			);
			assert.isNotNull(dueOn);

			assert.deepEqual(await projects.finish(tenant, OWNER, project, null), {
				status: "healing_check",
				due: 0n,
				estimated: false,
				dueOn,
			});
			assert.equal(await statusOf(project), "healing_check");

			const completed = await projects.completeHealingCheck(
				tenant,
				OWNER,
				project,
				null,
			);
			assert.equal(completed.status, "completed");
			assert.equal(await statusOf(project), "completed");
			// The sessions stay as they were.
			assert.deepEqual(
				(await sessions.listForProject(tenant, project)).map(
					({ status }) => status,
				),
				["completed"],
			);
		});
	});

	test("each step only from its own status; nothing changes otherwise", async ({
		assert,
	}) => {
		const { tenant, sita, OWNER } = await setup();
		await inTenant(tenant, async () => {
			for (const [index, status] of PROJECT_STATUSES.entries()) {
				if (status === "in_progress") continue;
				const project = await workDone(tenant, sita, status, 3 + index);
				assert.equal(
					await ruleOf(() => projects.finish(tenant, OWNER, project, null)),
					"move_not_allowed",
					status,
				);
				assert.equal(await statusOf(project), status);
			}
			for (const [index, status] of PROJECT_STATUSES.entries()) {
				if (status === "healing_check") continue;
				const project = await workDone(tenant, sita, status, 20 + index);
				assert.equal(
					await ruleOf(() =>
						projects.completeHealingCheck(tenant, OWNER, project, null),
					),
					"move_not_allowed",
					status,
				);
				assert.equal(await statusOf(project), status);
			}
		});
	});

	test("a scheduled session of any kind must get its outcome first", async ({
		assert,
	}) => {
		const { tenant, sita, OWNER } = await setup();
		await inTenant(tenant, async () => {
			const project = await workDone(tenant, sita);
			const startsAt = DateTime.utc().plus({ days: 5 }).startOf("hour");
			const consultation = await makeSession(tenant, project, sita, {
				kind: "consultation",
				startsAt,
				endsAt: startsAt.plus({ hours: 1 }),
			});
			assert.equal(
				await ruleOf(() => projects.finish(tenant, OWNER, project, null)),
				"session_scheduled",
			);
			assert.equal(await statusOf(project), "in_progress");

			await sessions.cancel(tenant, consultation);
			await projects.finish(tenant, OWNER, project, null);
			assert.equal(await statusOf(project), "healing_check");

			const touchUpAt = startsAt.plus({ days: 1 });
			const touchUp = await makeSession(tenant, project, sita, {
				kind: "touch_up",
				startsAt: touchUpAt,
				endsAt: touchUpAt.plus({ hours: 1 }),
			});
			assert.equal(
				await ruleOf(() =>
					projects.completeHealingCheck(tenant, OWNER, project, null),
				),
				"session_scheduled",
			);
			assert.equal(await statusOf(project), "healing_check");

			await sessions.complete(tenant, touchUp);
			await projects.completeHealingCheck(tenant, OWNER, project, null);
			assert.equal(await statusOf(project), "completed");
		});
	});

	test("money still owed must be confirmed at exactly its amount", async ({
		assert,
	}) => {
		const { owner, tenant, sita, OWNER } = await setup();
		await inTenant(tenant, async () => {
			const project = await workDone(tenant, sita);
			// NPR 15,000 with the NPR 3,000 deposit paid: NPR 12,000 owed.
			await makeQuote(tenant, project);
			await makePayment(tenant, project, verified(owner));

			for (const confirmed of [null, 0n, 1_000_000n, 1_500_000n]) {
				assert.equal(
					await ruleOf(() =>
						projects.finish(tenant, OWNER, project, confirmed),
					),
					"balance_changed",
					String(confirmed),
				);
			}
			assert.equal(await statusOf(project), "in_progress");

			const finished = await projects.finish(
				tenant,
				OWNER,
				project,
				1_200_000n,
			);
			assert.deepInclude(finished, {
				status: "healing_check",
				due: 1_200_000n,
				estimated: false,
			});
			// Closing the check asks again, for what is owed then.
			assert.equal(
				await ruleOf(() =>
					projects.completeHealingCheck(tenant, OWNER, project, null),
				),
				"balance_changed",
			);
			assert.equal(
				(
					await projects.completeHealingCheck(
						tenant,
						OWNER,
						project,
						1_200_000n,
					)
				).status,
				"completed",
			);
		});
	});

	test("nothing owed needs no confirmation: paid in full, overpaid or never priced", async ({
		assert,
	}) => {
		const { owner, tenant, sita, OWNER } = await setup();
		await inTenant(tenant, async () => {
			const paid = await workDone(tenant, sita, "in_progress", 7);
			await makeQuote(tenant, paid);
			await makePayment(tenant, paid, {
				kind: "balance",
				amount: 1_500_000,
				...verified(owner),
			});
			const overpaid = await workDone(tenant, sita, "in_progress", 9);
			await makeQuote(tenant, overpaid);
			await makePayment(tenant, overpaid, {
				kind: "balance",
				amount: 1_600_000,
				...verified(owner),
			});
			const unpriced = await workDone(tenant, sita, "in_progress", 11);

			for (const project of [paid, overpaid, unpriced]) {
				const finished = await projects.finish(tenant, OWNER, project, null);
				assert.equal(finished.due, 0n);
				assert.equal(await statusOf(project), "healing_check");
			}
		});
	});

	test("an hourly quote's balance is an estimate, and says so", async ({
		assert,
	}) => {
		const { tenant, sita, OWNER } = await setup();
		await inTenant(tenant, async () => {
			const project = await workDone(tenant, sita);
			// NPR 3,000 an hour for about 5 hours: NPR 15,000, nothing paid.
			await makeQuote(tenant, project, {
				kind: "hourly",
				fixedPrice: null,
				hourlyRate: 300_000,
				estimatedMinutes: 300,
				depositAmount: 0,
			});
			assert.deepInclude(
				await projects.finish(tenant, OWNER, project, 1_500_000n),
				{ due: 1_500_000n, estimated: true },
			);
		});
	});

	test("owners only: the assigned artist gets a 404 and nothing changes", async ({
		assert,
	}) => {
		const { tenant, sita } = await setup();
		const asha = await artistIn(tenant, `asha@${SLUG}.example`);
		const artist = { userId: asha.id, role: "artist" as const };
		await inTenant(tenant, async () => {
			sita.userId = asha.id;
			await sita.save();
			const working = await workDone(tenant, sita, "in_progress", 7);
			const healing = await workDone(tenant, sita, "healing_check", 9);

			assert.throws(() => projects.requireOwner(artist), /Row not found/);
			await assert.rejects(
				() => projects.finish(tenant, artist, working, null),
				/Row not found/,
			);
			await assert.rejects(
				() => projects.completeHealingCheck(tenant, artist, healing, null),
				/Row not found/,
			);
			assert.equal(await statusOf(working), "in_progress");
			assert.equal(await statusOf(healing), "healing_check");
		});
	});

	test("two tabs: the second tap on either step is refused and changes nothing", async ({
		assert,
	}) => {
		const { tenant, sita, OWNER } = await setup();
		await inTenant(tenant, async () => {
			const project = await workDone(tenant, sita);
			// Both tabs loaded the project while it was in progress.
			const stale = await TattooProject.findOrFail(project.id);

			await projects.finish(tenant, OWNER, project, null);
			assert.equal(
				await ruleOf(() => projects.finish(tenant, OWNER, stale, null)),
				"move_not_allowed",
			);
			assert.equal(await statusOf(project), "healing_check");

			await projects.completeHealingCheck(tenant, OWNER, stale, null);
			assert.equal(
				await ruleOf(() =>
					projects.completeHealingCheck(tenant, OWNER, stale, null),
				),
				"move_not_allowed",
			);
			assert.equal(await statusOf(project), "completed");
		});
	});

	test("two tabs: a payment or a new session since the page loaded is caught under the lock", async ({
		assert,
	}) => {
		const { tenant, sita, OWNER } = await setup();
		await inTenant(tenant, async () => {
			const project = await workDone(tenant, sita, "in_progress", 7);
			await makeQuote(tenant, project, { depositAmount: 0 });
			// The page showed NPR 15,000 owed; another tab took NPR 5,000 at the desk.
			await payments.record(tenant, OWNER, project, {
				kind: "balance",
				method: "cash",
				amount: 500_000,
				note: null,
			});
			assert.equal(
				await ruleOf(() => projects.finish(tenant, OWNER, project, 1_500_000n)),
				"balance_changed",
			);
			assert.equal(await statusOf(project), "in_progress");
			// Another tab took the rest: nothing is owed, so the old amount no
			// longer matters.
			await payments.record(tenant, OWNER, project, {
				kind: "balance",
				method: "cash",
				amount: 1_000_000,
				note: null,
			});
			assert.equal(
				(await projects.finish(tenant, OWNER, project, 1_500_000n)).due,
				0n,
			);

			// Another tab scheduled the next tattoo session: booked again.
			const more = await workDone(tenant, sita, "in_progress", 9);
			const startsAt = DateTime.utc().plus({ days: 4 }).startOf("hour");
			await sessions.scheduleFor(tenant, OWNER, more, {
				artistId: sita.id,
				kind: "tattoo",
				startsAt,
				endsAt: startsAt.plus({ hours: 2 }),
			});
			assert.equal(
				await ruleOf(() => projects.finish(tenant, OWNER, more, null)),
				"move_not_allowed",
			);
			assert.equal(await statusOf(more), "booked");
		});
	});

	test("money after finishing: balance payments and refunds still go in, and no deposit outcome is asked", async ({
		assert,
	}) => {
		const { owner, tenant, sita, OWNER } = await setup();
		await inTenant(tenant, async () => {
			const project = await workDone(tenant, sita);
			await makeQuote(tenant, project);
			// The NPR 3,000 deposit: NPR 12,000 owed.
			await makePayment(tenant, project, verified(owner));
			await projects.finish(tenant, OWNER, project, 1_200_000n);
			await payments.record(tenant, OWNER, project, {
				kind: "balance",
				method: "cash",
				amount: 1_000_000,
				note: null,
			});
			await projects.completeHealingCheck(tenant, OWNER, project, 200_000n);
			await payments.record(tenant, OWNER, project, {
				kind: "balance",
				method: "cash",
				amount: 200_000,
				note: null,
			});
			await payments.refund(tenant, OWNER, project, {
				method: "cash",
				amount: 50_000,
				note: null,
			});

			const money = await payments.forProject(
				tenant,
				await TattooProject.findOrFail(project.id),
			);
			assert.isFalse(money.outcomeNeeded);
			assert.equal(money.balance.due, 50_000n);
			assert.equal(await statusOf(project), "completed");
		});
	});

	test("the board flags money owed on a finished fixed-price project, never on an hourly one", async ({
		assert,
	}) => {
		const { owner, tenant, sita } = await setup();
		await inTenant(tenant, async () => {
			const owing = await workDone(tenant, sita, "completed", 7);
			await makeQuote(tenant, owing);
			const healing = await workDone(tenant, sita, "healing_check", 9);
			await makeQuote(tenant, healing);
			const paid = await workDone(tenant, sita, "completed", 11);
			await makeQuote(tenant, paid);
			await makePayment(tenant, paid, {
				kind: "balance",
				amount: 1_500_000,
				...verified(owner),
			});
			const hourly = await workDone(tenant, sita, "completed", 13);
			await makeQuote(tenant, hourly, {
				kind: "hourly",
				fixedPrice: null,
				hourlyRate: 300_000,
				estimatedMinutes: 300,
				depositAmount: 0,
			});
			const working = await workDone(tenant, sita, "in_progress", 15);
			await makeQuote(tenant, working);

			const all = [owing, healing, paid, hourly, working];
			const flags = await payments.listFlags(tenant, all);
			assert.deepEqual(
				all.map(({ id }) => flags.get(id)?.balanceOwed),
				[true, true, false, false, false],
			);
			// What is left to pay, for the Projects list's line (TAT-109): the whole
			// fixed price here, since the fixture records no payment.
			const due = 1_500_000n;
			assert.deepEqual(
				all.map(({ id }) => flags.get(id)?.balanceDue),
				[due, due, null, null, null],
			);
		});
	});
});
