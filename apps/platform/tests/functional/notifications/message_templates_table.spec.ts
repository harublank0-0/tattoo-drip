import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { MESSAGE_KINDS } from "#modules/notifications/messages";
import { withDbContext, withTransaction } from "#services/db_context";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { insertRow } from "#tests/helpers/sql";
import { studioWithOwner } from "#tests/helpers/tenants";

const row = (tenantId: string, over: Record<string, unknown> = {}) => ({
	tenant_id: tenantId,
	kind: "quote",
	body: "Hi {client_name}",
	...over,
});

test.group("message_templates table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("row-level security", async ({ assert }) => {
		// A different kind each time: a studio has one row per kind.
		let next = 0;
		await assertRowLevelSecurity(assert, "message_templates", async (tenant) =>
			row(tenant.id, { kind: MESSAGE_KINDS[next++ % MESSAGE_KINDS.length] }),
		);
	});

	test("one text per message kind per studio", async ({ assert }) => {
		const { tenant } = await studioWithOwner("templates-52");

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await insertRow(trx, "message_templates", row(tenant.id));
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "message_templates", row(tenant.id)),
					),
				/message_templates_tenant_id_kind_unique/,
			);
			await insertRow(
				trx,
				"message_templates",
				row(tenant.id, { kind: "aftercare" }),
			);
		});
	});

	test("the kind is one of the six, and the text 1 to 1,000 characters", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("templates-check-52");
		const rejects = (over: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "message_templates", row(tenant.id, over)),
					),
				message,
			);

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await rejects({ kind: "hello" }, /message_templates_kind_check/);
			await rejects({ body: "  " }, /message_templates_body_not_blank/);
			await rejects({ body: "x".repeat(1001) }, /value too long/);
			await insertRow(
				trx,
				"message_templates",
				row(tenant.id, { body: "🙏".repeat(1000) }),
			);
		});
	});
});
