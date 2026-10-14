import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ExpireQuoteJob from "#modules/projects/jobs/expire_quote_job";
import TattooProject from "#modules/projects/models/tattoo_project";
import { dispatchInTransaction } from "#services/queue";
import { makeClient, makeProject, makeQuote } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { processQueued, registerJob } from "#tests/helpers/worker";

/** The test's global transaction, which the test worker reads. */
const trx = () => db.connection() as TransactionClientContract;

test.group("ExpireQuoteJob", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => registerJob(ExpireQuoteJob));

	test("cancels the project in the payload's tenant once its quote expired", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { project, quote } = await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			const quote = await makeQuote(tenant, project, {
				expiresAt: DateTime.utc().minus({ minutes: 1 }),
			});
			return { project, quote };
		});

		await dispatchInTransaction(
			ExpireQuoteJob.dispatch({
				tenantId: tenant.id,
				projectId: project.id,
				quoteId: quote.id,
			}),
			trx(),
		);
		await processQueued();

		const reloaded = await inTenant(tenant, () =>
			TattooProject.findOrFail(project.id),
		);
		assert.equal(reloaded.status, "cancelled");
	});
});
