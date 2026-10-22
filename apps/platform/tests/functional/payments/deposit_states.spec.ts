import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import DepositLink from "#modules/payments/models/deposit_link";
import DepositService from "#modules/payments/services/deposit_service";
import QuoteService from "#modules/projects/services/quote_service";
import { depositReady, depositServices, OWNER } from "#tests/helpers/deposits";
import {
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { recordQueries } from "#tests/helpers/query_count";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const { links } = depositServices();
const quotes = new QuoteService();
const deposits = new DepositService(quotes);

/** Decided as verified: the database wants a decision time with the status. */
const verified = () => ({
	status: "verified" as const,
	verifiedAt: DateTime.utc(),
});
const rejected = () => ({
	status: "rejected" as const,
	verifiedAt: DateTime.utc(),
});

/** The recorded queries that select from `table` (the context setup's own are not counted). */
const readsOf = (queries: string[], table: string) =>
	queries.filter((sql) => sql.includes(`from "${table}"`));

/** A deposit_pending project, optionally with a quote. */
const projectIn = (
	tenant: { id: string },
	quote: Parameters<typeof makeQuote>[2] | null = {},
) =>
	inTenant(tenant, async () => {
		const project = await makeProject(tenant, await makeClient(tenant), {
			status: "deposit_pending",
		});
		if (quote) await makeQuote(tenant, project, quote);
		return project;
	});

test.group("DepositService.depositStates", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a waiting deposit screenshot is a proof; a decided one, another kind or nothing is not", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("states-proof-107");
		const waiting = await projectIn(tenant);
		const decided = await projectIn(tenant);
		const session = await projectIn(tenant);
		const none = await projectIn(tenant);
		await inTenant(tenant, async () => {
			await makePayment(tenant, waiting, { method: "esewa" });
			await makePayment(tenant, decided, { ...rejected() });
			await makePayment(tenant, session, { kind: "session" });
		});

		const states = await inTenant(tenant, async () => {
			const ids = [waiting, decided, session, none].map(({ id }) => id);
			return deposits.depositStates(
				tenant,
				ids,
				await quotes.currentFor(tenant, ids),
			);
		});

		assert.isTrue(states.get(waiting.id)?.proofWaiting);
		assert.isFalse(states.get(decided.id)?.proofWaiting);
		assert.isFalse(states.get(session.id)?.proofWaiting);
		assert.isFalse(states.get(none.id)?.proofWaiting);
		assert.equal(states.size, 4, "an entry per asked project");
	});

	test("settled agrees with isSettled for every way a deposit can stand", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("states-agree-107");
		const fixtures: Record<string, () => Promise<{ id: string }>> = {
			"no quote": () => projectIn(tenant, null),
			"zero deposit": () => projectIn(tenant, { depositAmount: 0 }),
			unpaid: () => projectIn(tenant),
			"half paid": async () => {
				const project = await projectIn(tenant);
				await inTenant(tenant, () =>
					makePayment(tenant, project, { amount: 150_000, ...verified() }),
				);
				return project;
			},
			"fully verified": async () => {
				const project = await projectIn(tenant);
				await inTenant(tenant, () => makePayment(tenant, project, verified()));
				return project;
			},
			"verified then reversed": async () => {
				const project = await projectIn(tenant);
				await inTenant(tenant, async () => {
					const deposit = await makePayment(tenant, project, verified());
					await makePayment(tenant, project, {
						kind: "correction",
						amount: -300_000,
						correctsPaymentId: deposit.id,
						...verified(),
					});
				});
				return project;
			},
			"only submitted": async () => {
				const project = await projectIn(tenant);
				await inTenant(tenant, () => makePayment(tenant, project));
				return project;
			},
			"only rejected": async () => {
				const project = await projectIn(tenant);
				await inTenant(tenant, () => makePayment(tenant, project, rejected()));
				return project;
			},
			"another currency": async () => {
				const project = await projectIn(tenant);
				await inTenant(tenant, () =>
					makePayment(tenant, project, { currency: "USD", ...verified() }),
				);
				return project;
			},
			"a refund doesn't count as a deposit": async () => {
				const project = await projectIn(tenant);
				await inTenant(tenant, async () => {
					await makePayment(tenant, project, verified());
					await makePayment(tenant, project, {
						kind: "refund",
						amount: -100_000,
						...verified(),
					});
				});
				return project;
			},
		};

		const projects: { name: string; id: string }[] = [];
		for (const [name, make] of Object.entries(fixtures)) {
			projects.push({ name, id: (await make()).id });
		}
		const ids = projects.map(({ id }) => id);
		await inTenant(tenant, async () => {
			const states = await deposits.depositStates(
				tenant,
				ids,
				await quotes.currentFor(tenant, ids),
			);
			for (const { name, id } of projects) {
				assert.equal(
					states.get(id)?.settled,
					await deposits.isSettled(tenant, { id }),
					name,
				);
			}
			// The fixtures are not all the same answer.
			assert.sameMembers(
				[...new Set(ids.map((id) => states.get(id)?.settled))],
				[true, false],
			);
		});
	});

	test("no projects, no query", async ({ assert }) => {
		const { tenant } = await studioWithOwner("states-empty-107");
		const { result, queries } = await recordQueries(() =>
			inTenant(tenant, () => deposits.depositStates(tenant, [], new Map())),
		);
		assert.equal(result.size, 0);
		assert.lengthOf(readsOf(queries, "payments"), 0);
	});

	test("one query for one project and for five", async ({ assert }) => {
		const { tenant } = await studioWithOwner("states-count-107");
		const made: { id: string }[] = [];
		for (let i = 0; i < 5; i++) made.push(await projectIn(tenant));
		const read = (count: number) =>
			recordQueries(() =>
				inTenant(tenant, () =>
					deposits.depositStates(
						tenant,
						made.slice(0, count).map(({ id }) => id),
						new Map(),
					),
				),
			);
		const one = await read(1);
		const five = await read(5);
		assert.lengthOf(readsOf(one.queries, "payments"), 1);
		assert.lengthOf(readsOf(five.queries, "payments"), 1);
		assert.equal(five.queries.length, one.queries.length);
	});

	test("another studio's payments are not read", async ({ assert }) => {
		const a = await studioWithOwner("states-a-107", "States A");
		const b = await studioWithOwner("states-b-107", "States B");
		const project = await projectIn(a.tenant);
		await inTenant(a.tenant, () => makePayment(a.tenant, project));

		const fromB = await inTenant(b.tenant, () =>
			deposits.depositStates(b.tenant, [project.id], new Map()),
		);
		assert.isFalse(fromB.get(project.id)?.proofWaiting ?? false);
		const fromA = await inTenant(a.tenant, () =>
			deposits.depositStates(a.tenant, [project.id], new Map()),
		);
		assert.isTrue(fromA.get(project.id)?.proofWaiting);
	});
});

test.group("DepositLinkService.statesFor", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a project without a link is absent; with one it works and says when it was made", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("states-link-107");
		const { project } = await inTenant(tenant, () => depositReady(tenant));
		const bare = await projectIn(tenant);
		await inTenant(tenant, () => links.issue(tenant, OWNER, project));

		const states = await inTenant(tenant, () =>
			links.statesFor(tenant, [project.id, bare.id]),
		);

		assert.isUndefined(states.get(bare.id));
		const state = states.get(project.id);
		assert.isTrue(state?.works);
		assert.isBelow(
			Math.abs(state?.madeAt.diffNow("seconds").seconds ?? 999),
			1,
		);
	});

	test("an expired link no longer works", async ({ assert }) => {
		const { tenant } = await studioWithOwner("states-expired-107");
		const { project } = await inTenant(tenant, () => depositReady(tenant));
		const { link } = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);
		await inTenant(tenant, () =>
			DepositLink.query()
				.where("id", link.id)
				.update({ expires_at: DateTime.utc().minus({ minutes: 1 }).toSQL() }),
		);

		const states = await inTenant(tenant, () =>
			links.statesFor(tenant, [project.id]),
		);
		assert.isFalse(states.get(project.id)?.works);
	});

	test("a new link restarts the clock", async ({ assert }) => {
		const { tenant } = await studioWithOwner("states-renew-107");
		const { project } = await inTenant(tenant, () => depositReady(tenant));
		const { link } = await inTenant(tenant, () =>
			links.issue(tenant, OWNER, project),
		);
		await inTenant(tenant, () =>
			DepositLink.query()
				.where("id", link.id)
				.update({ updated_at: DateTime.utc().minus({ days: 4 }).toSQL() }),
		);
		const old = await inTenant(tenant, () =>
			links.statesFor(tenant, [project.id]),
		);
		assert.closeTo(
			old.get(project.id)?.madeAt.diffNow("days").days ?? 0,
			-4,
			0.01,
		);

		await inTenant(tenant, () => links.issue(tenant, OWNER, project));
		const fresh = await inTenant(tenant, () =>
			links.statesFor(tenant, [project.id]),
		);
		assert.isBelow(
			Math.abs(fresh.get(project.id)?.madeAt.diffNow("seconds").seconds ?? 999),
			1,
		);
	});

	test("the answer holds nothing that opens the link", async ({ assert }) => {
		const { tenant } = await studioWithOwner("states-keys-107");
		const { project } = await inTenant(tenant, () => depositReady(tenant));
		await inTenant(tenant, () => links.issue(tenant, OWNER, project));

		const states = await inTenant(tenant, () =>
			links.statesFor(tenant, [project.id]),
		);
		assert.sameMembers(Object.keys(states.get(project.id) ?? {}), [
			"madeAt",
			"works",
		]);
	});

	test("no projects, no query; one query however many projects", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("states-queries-107");
		const { project: first } = await inTenant(tenant, () =>
			depositReady(tenant),
		);
		const made = [first];
		for (let i = 0; i < 3; i++) made.push(await projectIn(tenant));
		for (const project of made) {
			await inTenant(tenant, () => links.issue(tenant, OWNER, project));
		}
		const empty = await recordQueries(() =>
			inTenant(tenant, () => links.statesFor(tenant, [])),
		);
		assert.lengthOf(readsOf(empty.queries, "deposit_links"), 0);
		const one = await recordQueries(() =>
			inTenant(tenant, () => links.statesFor(tenant, [made[0].id])),
		);
		const four = await recordQueries(() =>
			inTenant(tenant, () =>
				links.statesFor(
					tenant,
					made.map(({ id }) => id),
				),
			),
		);
		assert.lengthOf(readsOf(one.queries, "deposit_links"), 1);
		assert.lengthOf(readsOf(four.queries, "deposit_links"), 1);
		assert.equal(four.queries.length, one.queries.length);
	});

	test("another studio's links are not read", async ({ assert }) => {
		const a = await studioWithOwner("states-link-a-107", "Link A");
		const b = await studioWithOwner("states-link-b-107", "Link B");
		const { project } = await inTenant(a.tenant, () => depositReady(a.tenant));
		await inTenant(a.tenant, () => links.issue(a.tenant, OWNER, project));

		const fromB = await inTenant(b.tenant, () =>
			links.statesFor(b.tenant, [project.id]),
		);
		assert.equal(fromB.size, 0);
	});
});
