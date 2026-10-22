import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import { paymentServices } from "#tests/helpers/payments";
import {
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { recordQueries } from "#tests/helpers/query_count";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const { payments, quotes } = paymentServices();

const verified = () => ({
	status: "verified" as const,
	verifiedAt: DateTime.utc(),
});

/** `count` projects of each kind a flag reads a quote for, every one with a quote and a deposit. */
async function projectsOf(
	tenant: { id: string },
	count: number,
	status: ProjectStatus[],
) {
	const client = await makeClient(tenant);
	const made = [];
	for (let at = 0; at < count; at++) {
		for (const one of status) {
			const project = await makeProject(tenant, client, { status: one });
			// An expired quote and a late decision make quoteLapsed true.
			await makeQuote(
				tenant,
				project,
				one === "deposit_pending"
					? { expiresAt: DateTime.utc().minus({ hours: 1 }) }
					: {},
			);
			await makePayment(
				tenant,
				project,
				one === "deposit_pending"
					? { status: "rejected", verifiedAt: DateTime.utc() }
					: verified(),
			);
			made.push(project);
		}
	}
	return made;
}

test.group("PaymentService.listFlags query count (TAT-111)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const KINDS: ProjectStatus[] = ["completed", "cancelled", "deposit_pending"];

	test("the Closed page's balance flag costs the same queries for 1 finished row as for 10", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("flag-n1-111", "Black Needle");
		const counts = [];
		for (const count of [1, 10]) {
			const rows = await inTenant(tenant, () =>
				projectsOf(tenant, count, ["completed"]),
			);
			const { result, queries } = await recordQueries(() =>
				inTenant(tenant, () => payments.listFlags(tenant, rows)),
			);
			assert.lengthOf(result, rows.length);
			counts.push(queries.length);
		}
		assert.equal(counts[1], counts[0], `queries: ${counts.join(" then ")}`);
	});

	test("all three quote-reading flags together do not grow with the rows", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("flag-n1b-111", "Black Needle");
		const counts = [];
		const flagged = [];
		for (const count of [1, 10]) {
			const rows = await inTenant(tenant, () =>
				projectsOf(tenant, count, KINDS),
			);
			const { result, queries } = await recordQueries(() =>
				inTenant(tenant, () => payments.listFlags(tenant, rows)),
			);
			counts.push(queries.length);
			flagged.push(
				KINDS.map(
					(_, kind) =>
						[...result.values()].filter((flags) =>
							kind === 0
								? flags.balanceOwed
								: kind === 1
									? flags.depositToSettle
									: flags.quoteLapsed,
						).length,
				),
			);
		}
		// The flags still fire: every project of its kind is flagged (the
		// second pass lists only its own rows).
		assert.deepEqual(flagged[0], [1, 1, 1]);
		assert.deepEqual(flagged[1], [10, 10, 10]);
		assert.equal(counts[1], counts[0], `queries: ${counts.join(" then ")}`);
	});

	test("balancesFor does not grow with the rows either", async ({ assert }) => {
		const { tenant } = await studioWithOwner("flag-n1c-111", "Black Needle");
		const counts = [];
		for (const count of [1, 10]) {
			const rows = await inTenant(tenant, () =>
				projectsOf(tenant, count, ["completed"]),
			);
			const { result, queries } = await recordQueries(() =>
				inTenant(tenant, () => payments.balancesFor(tenant, rows)),
			);
			assert.equal(result.size, rows.length);
			counts.push(queries.length);
		}
		assert.equal(counts[1], counts[0], `queries: ${counts.join(" then ")}`);
	});

	test("QuoteService.currentFor gives each project its highest version, only the studio's", async ({
		assert,
	}) => {
		const a = await studioWithOwner("flag-cur-a-111", "Black Needle");
		const b = await studioWithOwner("flag-cur-b-111", "Red Ink");
		const other = await inTenant(b.tenant, async () => {
			const client = await makeClient(b.tenant);
			const project = await makeProject(b.tenant, client, {
				status: "booked",
			});
			await makeQuote(b.tenant, project);
			return project;
		});
		const { one, two, none } = await inTenant(a.tenant, async () => {
			const client = await makeClient(a.tenant);
			const one = await makeProject(a.tenant, client, { status: "booked" });
			await makeQuote(a.tenant, one, { version: 1 });
			await makeQuote(a.tenant, one, { version: 2, fixedPrice: 2_000_000 });
			const two = await makeProject(a.tenant, client, { status: "booked" });
			await makeQuote(a.tenant, two);
			const none = await makeProject(a.tenant, client, { status: "booked" });
			return { one, two, none };
		});

		const current = await inTenant(a.tenant, () =>
			quotes.currentFor(a.tenant, [one.id, two.id, none.id, other.id]),
		);
		assert.equal(current.get(one.id)?.version, 2);
		assert.equal(current.get(one.id)?.fixedPrice, 2_000_000);
		assert.equal(current.get(two.id)?.version, 1);
		assert.isUndefined(current.get(none.id));
		// Another studio's project is not found through this studio.
		assert.isUndefined(current.get(other.id));
		assert.equal(
			(await inTenant(a.tenant, () => quotes.currentFor(a.tenant, []))).size,
			0,
		);
	});
});
