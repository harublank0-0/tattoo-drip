import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * One member's alert about one event (TAT-52): a new inquiry so far (the
 * deposit-proof follow-up adds a kind and its columns). Ids only, never
 * client data; the list shows a fixed line per kind. Unique per member and
 * inquiry, so the alert job's `on conflict do nothing` makes a rerun add
 * nothing. Deleting the account removes its alerts; so does a hard delete
 * of the inquiry. Not soft-deleted: read or unread, and kept.
 */
export default class extends BaseSchema {
	protected tableName = "staff_alerts";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table
				.uuid("user_id")
				.notNullable()
				.references("id")
				.inTable("users")
				.onDelete("CASCADE");
			table.enum("kind", ["new_inquiry"]).notNullable();
			table.uuid("inquiry_id").nullable();
			table.timestamp("read_at", { useTz: true }).nullable();
			table.timestamp("created_at", { useTz: true }).notNullable();

			tenantReference(table, "inquiry_id", "inquiries");

			// One alert per member per inquiry; also the user_id index.
			table.unique(["user_id", "inquiry_id"]);
			// The Alerts page: a member's alerts in a studio, newest first.
			table.index(["tenant_id", "user_id", "created_at"]);
			// The composite key's index.
			table.index(["tenant_id", "inquiry_id"]);
		});
		for (const statement of [
			"alter table staff_alerts add constraint staff_alerts_subject_matches_kind check ((kind = 'new_inquiry') = (inquiry_id is not null))",
			// The shell's unread count.
			"create index staff_alerts_unread_index on staff_alerts (tenant_id, user_id) where read_at is null",
			...enableTenantRls(this.tableName),
		]) {
			this.schema.raw(statement);
		}
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
