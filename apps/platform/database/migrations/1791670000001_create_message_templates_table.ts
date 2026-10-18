import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
} from "#database/helpers/tenant_rls";

/** The six message kinds (#modules/notifications/messages; copied). */
const KINDS = [
	"inquiry_received",
	"quote",
	"deposit_link",
	"booking_confirmation",
	"session_reminder",
	"aftercare",
];

/**
 * A studio's own text for one of its chat messages (TAT-52). A row exists
 * only for a message the studio changed: the defaults live in code, and
 * saving the default text again deletes the row. Not soft-deleted: a
 * setting replaced in place.
 */
export default class extends BaseSchema {
	protected tableName = "message_templates";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.enum("kind", KINDS).notNullable();
			table.string("body", 1000).notNullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			// One text per kind; also the tenant_id index.
			table.unique(["tenant_id", "kind"]);
		});
		this.schema.raw(
			"alter table message_templates add constraint message_templates_body_not_blank check (btrim(body) <> '')",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
