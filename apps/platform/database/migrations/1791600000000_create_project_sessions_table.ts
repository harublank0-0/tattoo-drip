import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * A time block for one artist inside a project (TAT-36). `active` is the one
 * definition of "blocks time": a session is active while it is scheduled or
 * completed and not deleted. The exclusion constraint keeps one artist from
 * having two active sessions that overlap; the range is half-open, so
 * back-to-back sessions are fine. Table name: not `sessions`, which the
 * database session store of AdonisJS uses by default.
 */
export default class extends BaseSchema {
	protected tableName = "project_sessions";

	async up() {
		// A gist index needs this extension to compare a uuid with `=`.
		// Available on PostgreSQL 18; creating it takes the owner role, which
		// is who runs migrations.
		this.schema.raw("create extension if not exists btree_gist");

		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("project_id").notNullable();
			table.uuid("artist_id").notNullable();
			table.enum("kind", ["consultation", "tattoo", "touch_up"]).notNullable();
			table.timestamp("starts_at", { useTz: true }).notNullable();
			table.timestamp("ends_at", { useTz: true }).notNullable();
			table
				.enum("status", ["scheduled", "completed", "no_show", "cancelled"])
				.notNullable()
				.defaultTo("scheduled");

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();

			tenantReference(table, "project_id", "tattoo_projects", "NO ACTION");
			tenantReference(table, "artist_id", "artists", "NO ACTION");

			table.index(["tenant_id", "project_id"]);
			// The artist foreign key's index, and the calendar's.
			table.index(["tenant_id", "artist_id", "starts_at"]);
			// An owner's studio-wide view.
			table.index(["tenant_id", "starts_at"]);
		});

		this.schema.raw(
			"alter table project_sessions add column active boolean generated always as (deleted_at is null and status in ('scheduled', 'completed')) stored",
		);
		this.schema.raw(
			"alter table project_sessions add constraint project_sessions_ends_after_starts check (ends_at > starts_at)",
		);
		this.schema.raw(
			"alter table project_sessions add constraint project_sessions_artist_no_overlap exclude using gist (artist_id with =, tstzrange(starts_at, ends_at) with &&) where (active)",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
		// btree_gist stays: nothing says only this table uses it.
	}
}
