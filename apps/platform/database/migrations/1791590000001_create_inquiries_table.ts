import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * What a person asked a studio for, as submitted (TAT-37). The guard
 * trigger makes it a frozen record: only the decision can change, and the
 * contact snapshot and free text can be scrubbed when `anonymized_at` is
 * set (TAT-42). Everything else is frozen, including any column added later.
 */
export default class extends BaseSchema {
	protected tableName = "inquiries";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("client_id").notNullable();
			table.string("idea", 4000).notNullable();
			table.string("placement", 120).notNullable();
			table.string("approximate_size", 120).notNullable();
			table.string("preferred_dates", 500).notNullable();
			table.uuid("preferred_artist_id").nullable();
			table.string("budget", 120).nullable();
			table
				.enum("source_channel", [
					"instagram",
					"facebook",
					"tiktok",
					"google",
					"friend",
					"other",
				])
				.notNullable();
			// The contact as submitted. Null phone only once anonymized.
			table.string("contact_name", 120).notNullable();
			table.string("contact_phone", 16).nullable();
			table.string("contact_email", 254).nullable();
			table
				.enum("status", ["new", "accepted", "declined"])
				.notNullable()
				.defaultTo("new");
			table.timestamp("decided_at", { useTz: true }).nullable();
			table.timestamp("anonymized_at", { useTz: true }).nullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();

			// The parents' UNIQUE (tenant_id, id) from enableTenantRls (clients,
			// artists) is what these keys point at.
			tenantReference(table, "client_id", "clients", "NO ACTION");
			tenantReference(table, "preferred_artist_id", "artists", "NO ACTION");

			table.index(["tenant_id"]);
			// The inbox.
			table.index(["tenant_id", "status", "created_at"]);
			table.index(["tenant_id", "client_id"]);
			table.index(["tenant_id", "preferred_artist_id"]);
		});

		this.schema.raw(
			"alter table inquiries add constraint inquiries_decided_matches_status check ((status = 'new') = (decided_at is null))",
		);
		this.schema.raw(
			"alter table inquiries add constraint inquiries_contact_phone_e164 check (contact_phone ~ '^[+][1-9][0-9]{7,14}$')",
		);
		this.schema.raw(
			"alter table inquiries add constraint inquiries_contact_phone_unless_anonymized check (contact_phone is not null or anonymized_at is not null)",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);

		this.schema.raw(`
create function inquiries_guard_update() returns trigger language plpgsql as $$
declare
	free text[] := array['status', 'decided_at', 'deleted_at', 'updated_at', 'anonymized_at'];
	scrub text[] := array['contact_name', 'contact_phone', 'contact_email', 'idea', 'placement', 'approximate_size', 'preferred_dates', 'budget'];
	changed text;
begin
	if old.anonymized_at is not null and new.anonymized_at is distinct from old.anonymized_at then
		raise exception 'inquiries_guard_update: anonymized_at cannot change';
	end if;
	if new.anonymized_at is not null then
		free := free || scrub;
	end if;
	select n.key into changed
		from jsonb_each(to_jsonb(new)) as n(key, value)
		where n.key <> all (free) and n.value is distinct from (to_jsonb(old) -> n.key)
		limit 1;
	if changed is not null then
		raise exception 'inquiries_guard_update: % cannot change', changed;
	end if;
	return new;
end
$$`);
		this.schema.raw(
			"create trigger inquiries_guard_update before update on inquiries for each row execute function inquiries_guard_update()",
		);
	}

	async down() {
		this.schema.raw("drop trigger inquiries_guard_update on inquiries");
		this.schema.raw("drop function inquiries_guard_update()");
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
