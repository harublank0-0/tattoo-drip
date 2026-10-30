import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { withDbContext, withTransaction } from "#services/db_context";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { insertRow, sql } from "#tests/helpers/sql";
import { studioWithOwner } from "#tests/helpers/tenants";

// Raw SQL only (TAT-128): the database itself must keep a studio's hours and
// closed days inside its tenant and refuse impossible rows, whatever the
// app's own query code does.
const hour = (tenantId: string, over: Record<string, unknown> = {}) => ({
	tenant_id: tenantId,
	weekday: 1,
	opens_at: "11:00",
	closes_at: "20:00",
	...over,
});

const closure = (tenantId: string, over: Record<string, unknown> = {}) => ({
	tenant_id: tenantId,
	starts_on: "2026-11-02",
	ends_on: "2026-11-04",
	note: "Closed for Dashain",
	...over,
});

test.group("studio_hours table (TAT-128)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("row-level security", async ({ assert }) => {
		// A different weekday each time: a studio has one row per weekday.
		let next = 0;
		await assertRowLevelSecurity(assert, "studio_hours", async (tenant) =>
			hour(tenant.id, { weekday: next++ % 7 }),
		);
	});

	test("update and delete of another tenant's rows affect zero rows", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("hours-a");
		const { tenant: b } = await studioWithOwner("hours-b");
		await withDbContext({ tenantId: b.id }, (trx) =>
			insertRow(trx, "studio_hours", hour(b.id)),
		);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const update = await trx.rawQuery(
				"update studio_hours set opens_at = '01:00' where tenant_id = ?",
				[b.id],
			);
			const remove = await trx.rawQuery(
				"delete from studio_hours where tenant_id = ?",
				[b.id],
			);
			assert.equal(update.rowCount, 0);
			assert.equal(remove.rowCount, 0);
		});
		const { rows } = await sql(
			{ tenantId: b.id },
			"select opens_at::text as opens_at from studio_hours",
		);
		assert.deepEqual(rows, [{ opens_at: "11:00:00" }]);
	});

	test("a weekday outside 0 to 6 is refused", async ({ assert }) => {
		const { tenant } = await studioWithOwner("hours-weekday");

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			for (const weekday of [-1, 7]) {
				await assert.rejects(
					() =>
						withTransaction((inner) =>
							insertRow(inner, "studio_hours", hour(tenant.id, { weekday })),
						),
					/studio_hours_weekday_range/,
				);
			}
			await insertRow(trx, "studio_hours", hour(tenant.id, { weekday: 0 }));
			await insertRow(trx, "studio_hours", hour(tenant.id, { weekday: 6 }));
		});
	});

	test("closing at or before opening is refused", async ({ assert }) => {
		const { tenant } = await studioWithOwner("hours-order");

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			for (const closes_at of ["11:00", "10:59"]) {
				await assert.rejects(
					() =>
						withTransaction((inner) =>
							insertRow(inner, "studio_hours", hour(tenant.id, { closes_at })),
						),
					/studio_hours_closes_after_opens/,
				);
			}
			await insertRow(
				trx,
				"studio_hours",
				hour(tenant.id, { closes_at: "11:01" }),
			);
		});
	});

	test("a second row for the same weekday is refused", async ({ assert }) => {
		const { tenant } = await studioWithOwner("hours-unique");

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await insertRow(trx, "studio_hours", hour(tenant.id));
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "studio_hours", hour(tenant.id)),
					),
				/studio_hours_tenant_id_weekday_unique/,
			);
			await insertRow(trx, "studio_hours", hour(tenant.id, { weekday: 2 }));
		});
	});
});

test.group("studio_closures table (TAT-128)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(assert, "studio_closures", async (tenant) =>
			closure(tenant.id),
		);
	});

	test("update and delete of another tenant's rows affect zero rows", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("closures-a");
		const { tenant: b } = await studioWithOwner("closures-b");
		await withDbContext({ tenantId: b.id }, (trx) =>
			insertRow(trx, "studio_closures", closure(b.id)),
		);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const update = await trx.rawQuery(
				"update studio_closures set note = 'hacked' where tenant_id = ?",
				[b.id],
			);
			const remove = await trx.rawQuery(
				"delete from studio_closures where tenant_id = ?",
				[b.id],
			);
			assert.equal(update.rowCount, 0);
			assert.equal(remove.rowCount, 0);
		});
		const { rows } = await sql(
			{ tenantId: b.id },
			"select note from studio_closures",
		);
		assert.deepEqual(rows, [{ note: "Closed for Dashain" }]);
	});

	test("a last day before the first is refused, the same day is fine", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("closures-order");

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"studio_closures",
							closure(tenant.id, { ends_on: "2026-11-01" }),
						),
					),
				/studio_closures_ends_after_starts/,
			);
			await insertRow(
				trx,
				"studio_closures",
				closure(tenant.id, { ends_on: "2026-11-02" }),
			);
		});
	});

	test("a blank note is refused, null is fine", async ({ assert }) => {
		const { tenant } = await studioWithOwner("closures-note");

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"studio_closures",
							closure(tenant.id, { note: "   " }),
						),
					),
				/studio_closures_note_not_blank/,
			);
			await insertRow(
				trx,
				"studio_closures",
				closure(tenant.id, { note: null }),
			);
		});
	});

	test("a note over 120 characters is refused", async ({ assert }) => {
		const { tenant } = await studioWithOwner("closures-long");

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"studio_closures",
							closure(tenant.id, { note: "x".repeat(121) }),
						),
					),
				/value too long/,
			);
			await insertRow(
				trx,
				"studio_closures",
				closure(tenant.id, { note: "ब".repeat(120) }),
			);
		});
	});
});

test.group("tenants Good to know texts (TAT-128)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a studio's Good to know texts start empty", async ({ assert }) => {
		const { tenant } = await studioWithOwner("good-to-know-empty");

		const { rows } = await sql(
			{ tenantId: tenant.id },
			"select walk_ins_text, age_rule_text, before_session_text, aftercare_text from tenants where id = ?",
			[tenant.id],
		);

		assert.deepEqual(rows, [
			{
				walk_ins_text: null,
				age_rule_text: null,
				before_session_text: null,
				aftercare_text: null,
			},
		]);
	});
});
