import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
} from "#database/helpers/tenant_rls";

/**
 * A studio's opening hours and closed days (TAT-128), plus four short texts
 * for clients on `tenants`.
 *
 * Rows rather than a JSON column on purpose: scheduling will read them as
 * the studio-wide hours and closures (docs/data-model.md), a slot engine can
 * join against SQL types, and the database itself refuses a closing time
 * before the opening.
 *
 * `studio_hours` has one row per OPEN weekday (a weekday without a row is
 * closed). `weekday` is 0 = Sunday ... 6 = Saturday, like Postgres
 * `extract(dow)` and JavaScript `getDay()`. Times are the studio's wall
 * clock in `tenants.timezone`; hours never run past midnight.
 *
 * `studio_closures` are dated closures, first day to last day (both
 * included), with a one-line note.
 *
 * Neither table is soft-deleted: they are settings replaced in place, like
 * `message_templates`. The walk-ins, age, before-session and aftercare texts
 * are plain profile text, like `intro` and `deposit_policy`.
 */
export default class extends BaseSchema {
	async up() {
		this.schema.createTable("studio_hours", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.smallint("weekday").notNullable();
			table.time("opens_at").notNullable();
			table.time("closes_at").notNullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			// One row per weekday; also the tenant_id index.
			table.unique(["tenant_id", "weekday"]);
		});
		this.schema.raw(
			"alter table studio_hours add constraint studio_hours_weekday_range check (weekday between 0 and 6)",
		);
		this.schema.raw(
			"alter table studio_hours add constraint studio_hours_closes_after_opens check (closes_at > opens_at)",
		);
		for (const sql of enableTenantRls("studio_hours")) this.schema.raw(sql);

		this.schema.createTable("studio_closures", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.date("starts_on").notNullable();
			table.date("ends_on").notNullable();
			table.string("note", 120).nullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			// "Which closures has this studio that have not ended".
			table.index(["tenant_id", "ends_on"], "studio_closures_tenant_ends");
		});
		this.schema.raw(
			"alter table studio_closures add constraint studio_closures_ends_after_starts check (ends_on >= starts_on)",
		);
		this.schema.raw(
			"alter table studio_closures add constraint studio_closures_note_not_blank check (note is null or btrim(note) <> '')",
		);
		for (const sql of enableTenantRls("studio_closures")) this.schema.raw(sql);

		this.schema.alterTable("tenants", (table) => {
			table.string("walk_ins_text", 300).nullable();
			table.string("age_rule_text", 200).nullable();
			table.string("before_session_text", 2000).nullable();
			table.string("aftercare_text", 2000).nullable();
		});
	}

	async down() {
		this.schema.alterTable("tenants", (table) => {
			table.dropColumn("walk_ins_text");
			table.dropColumn("age_rule_text");
			table.dropColumn("before_session_text");
			table.dropColumn("aftercare_text");
		});
		for (const sql of disableTenantRls("studio_closures")) this.schema.raw(sql);
		this.schema.dropTable("studio_closures");
		for (const sql of disableTenantRls("studio_hours")) this.schema.raw(sql);
		this.schema.dropTable("studio_hours");
	}
}
