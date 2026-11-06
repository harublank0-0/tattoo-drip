import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
} from "#database/helpers/tenant_rls";

/**
 * A studio's own FAQ entries and policy sections, and the date its policies
 * last changed (docs/superpowers/specs/2026-11-06-studio-faq-and-policies-design.md).
 *
 * Both lists are settings replaced in place, like `studio_hours`: not
 * soft-deleted, one row per entry with its 0-based `position`, unique per
 * studio. The position's range is each list's limit (20 entries, 12
 * sections); StudioContentService refuses a longer list before it writes.
 * Texts are plain text.
 *
 * `tenants.policies_updated_at` is set by StudioContentService when the
 * sections change, and by the `tenants_date_policies` trigger when one of
 * the three Good to know texts the policies page shows changes value: the
 * deposit policy (edited under Payments), the age rule and walk-ins (Good to
 * know). One rule for every path that writes them.
 */
const LISTS = [
	{
		table: "studio_faq_entries",
		a: "question",
		aMax: 200,
		b: "answer",
		bMax: 2000,
		last: 19,
	},
	{
		table: "studio_policy_sections",
		a: "title",
		aMax: 80,
		b: "text",
		bMax: 4000,
		last: 11,
	},
] as const;

export default class extends BaseSchema {
	async up() {
		for (const list of LISTS) {
			this.schema.createTable(list.table, (table) => {
				table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
				table
					.uuid("tenant_id")
					.notNullable()
					.references("id")
					.inTable("tenants")
					.onDelete("CASCADE");
				table.smallint("position").notNullable();
				table.string(list.a, list.aMax).notNullable();
				table.string(list.b, list.bMax).notNullable();
				table.timestamp("created_at", { useTz: true }).notNullable();
				table.timestamp("updated_at", { useTz: true }).nullable();
				// One row per place; also the tenant_id index.
				table.unique(["tenant_id", "position"]);
			});
			this.schema.raw(
				`alter table ${list.table} add constraint ${list.table}_position_range check (position between 0 and ${list.last})`,
			);
			for (const column of [list.a, list.b]) {
				this.schema.raw(
					`alter table ${list.table} add constraint ${list.table}_${column}_filled check (btrim(${column}) <> '')`,
				);
			}
			for (const sql of enableTenantRls(list.table)) this.schema.raw(sql);
		}

		this.schema.alterTable("tenants", (table) => {
			table.timestamp("policies_updated_at", { useTz: true }).nullable();
		});
		// search_path is pinned so a session cannot shadow the built-ins it calls.
		this.schema.raw(`
create function tenants_date_policies() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
	if new.deposit_policy is distinct from old.deposit_policy
		or new.age_rule_text is distinct from old.age_rule_text
		or new.walk_ins_text is distinct from old.walk_ins_text then
		new.policies_updated_at := now();
	end if;
	return new;
end
$$`);
		this.schema.raw(
			"create trigger tenants_date_policies before update on tenants for each row execute function tenants_date_policies()",
		);
	}

	async down() {
		this.schema.raw("drop trigger tenants_date_policies on tenants");
		this.schema.raw("drop function tenants_date_policies()");
		this.schema.alterTable("tenants", (table) => {
			table.dropColumn("policies_updated_at");
		});
		for (const list of [...LISTS].reverse()) {
			for (const sql of disableTenantRls(list.table)) this.schema.raw(sql);
			this.schema.dropTable(list.table);
		}
	}
}
