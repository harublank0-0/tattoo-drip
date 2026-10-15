import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import QuoteService, {
	type NewQuote,
} from "#modules/projects/services/quote_service";
import { withTransaction } from "#services/db_context";
import { makeClient, makeProject, makeQuote } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const quotes = new QuoteService();

const fixed = (): NewQuote => ({
	kind: "fixed",
	fixedPrice: 1_500_000,
	depositAmount: 300_000,
	expiresAt: DateTime.utc().plus({ days: 14 }),
});

const hourly = (): NewQuote => ({
	kind: "hourly",
	hourlyRate: 300_000,
	estimatedMinutes: 270,
	depositAmount: 0,
	expiresAt: DateTime.utc().plus({ days: 14 }),
});

test.group("QuoteService", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("current is null without a quote, then the highest version", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			assert.isNull(await quotes.current(tenant, project));

			await makeQuote(tenant, project, { version: 1 });
			const v3 = await makeQuote(tenant, project, { version: 3 });
			await makeQuote(tenant, project, { version: 2 });

			assert.equal((await quotes.current(tenant, project))?.id, v3.id);
			assert.deepEqual(
				(await quotes.history(tenant, project)).map(({ version }) => version),
				[3, 2, 1],
			);
		});
	});

	test("create numbers versions per project and stores the kind's columns", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const first = await makeProject(tenant, client);
			const second = await makeProject(tenant, client);

			const a1 = await withTransaction((trx) =>
				quotes.create(trx, tenant, first, fixed()),
			);
			const a2 = await withTransaction((trx) =>
				quotes.create(trx, tenant, first, hourly()),
			);
			const b1 = await withTransaction((trx) =>
				quotes.create(trx, tenant, second, fixed()),
			);

			assert.deepEqual([a1.version, a2.version, b1.version], [1, 2, 1]);
			assert.include(a1.serialize(), {
				kind: "fixed",
				fixedPrice: 1_500_000,
				hourlyRate: null,
				estimatedMinutes: null,
				depositAmount: 300_000,
				currency: "NPR",
			});
			assert.include(a2.serialize(), {
				kind: "hourly",
				fixedPrice: null,
				hourlyRate: 300_000,
				estimatedMinutes: 270,
				depositAmount: 0,
			});
		});
	});

	test("another tenant sees none of the project's quotes", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		const project = await inTenant(a, async () => {
			const project = await makeProject(a, await makeClient(a));
			await makeQuote(a, project);
			return project;
		});

		await inTenant(b, async () => {
			assert.isNull(await quotes.current(b, project));
			assert.deepEqual(await quotes.history(b, project), []);
		});
	});
});
