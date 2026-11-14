import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import ClientReview from "#modules/reviews/models/client_review";
import Tenant from "#modules/tenancy/models/tenant";
import { sql } from "#tests/helpers/sql";
import {
	inTenant,
	type Studio,
	seededStudio,
	twoStudios,
} from "#tests/helpers/tenants";

type Row = { tenant_id: string; review_id: string };

/** The function's rows for these studios only: it sees every tenant's committed rows, and locally the tests share the dev database. */
async function reportsOf(...studios: Studio[]) {
	const ids = new Set(studios.map(({ tenant }) => tenant.id));
	const { rows } = await sql({}, "select * from public.open_review_reports()");
	return (rows as Row[]).filter(({ tenant_id }) => ids.has(tenant_id));
}

function report(studio: Studio, values: Record<string, unknown> = {}) {
	return inTenant(studio.tenant, () =>
		ClientReview.withTrashed()
			.where("id", studio.clientReview.id)
			.update({ reported_at: new Date(), report_reason: "hate", ...values }),
	);
}

test.group("open_review_reports()", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists every studio's open reports as ids, though the app role alone sees no review", async ({
		assert,
	}) => {
		const { a, b } = await twoStudios();
		await report(a);
		await report(b);
		const { rows } = await sql(
			{},
			"select count(*)::int as n from client_reviews",
		);
		assert.equal(rows[0].n, 0);
		assert.sameDeepMembers(await reportsOf(a, b), [
			{ tenant_id: a.tenant.id, review_id: a.clientReview.id },
			{ tenant_id: b.tenant.id, review_id: b.clientReview.id },
		]);
	});

	test("leaves out reviews not reported, decided (dismissed or taken down), deleted, and of a deleted studio", async ({
		assert,
	}) => {
		const { a, b } = await twoStudios();
		assert.deepEqual(await reportsOf(a, b), [], "nothing reported");
		await report(a, { report_resolved_at: new Date() });
		await report(b, { taken_down_at: new Date(), takedown_reason: "hate" });
		assert.deepEqual(await reportsOf(a, b), []);

		await report(a, { report_resolved_at: null });
		await inTenant(a.tenant, () =>
			ClientReview.query().where("id", a.clientReview.id).update({
				deleted_at: new Date(),
				rating: null,
				body: "",
				shown_name: "",
			}),
		);
		assert.deepEqual(await reportsOf(a), []);

		const c = await seededStudio("rep-c-2", "Rep C");
		await report(c);
		assert.lengthOf(await reportsOf(c), 1);
		await inTenant(c.tenant, async () =>
			(await Tenant.findOrFail(c.tenant.id)).softDelete(),
		);
		assert.deepEqual(await reportsOf(c), []);
	});

	test("returns ids only", async ({ assert }) => {
		const { a } = await twoStudios();
		await report(a);
		const [row] = await reportsOf(a);
		assert.sameMembers(Object.keys(row), ["tenant_id", "review_id"]);
	});
});
