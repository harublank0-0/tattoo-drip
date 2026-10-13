import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * The sale of one tattoo (TAT-37): created when an inquiry is accepted, or
 * directly for a walk-in. The lifecycle rules (which status may follow
 * which) belong to TAT-46; this table only keeps the allowed values.
 */
export default class extends BaseSchema {
	protected tableName = "tattoo_projects";

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
			// Nobody assigned yet, for example an accepted inquiry with no
			// preferred artist.
			table.uuid("artist_id").nullable();
			// Null for a project created directly (walk-in, phone, DM).
			table.uuid("inquiry_id").nullable();
			table.string("brief", 4000).notNullable();
			table.string("notes", 4000).nullable();
			table.timestamp("last_contacted_at", { useTz: true }).nullable();
			table
				.enum("status", [
					"reviewing",
					"quoted",
					"on_hold",
					"deposit_pending",
					"booked",
					"in_progress",
					"completed",
					"healing_check",
					"declined",
					"cancelled",
				])
				.notNullable()
				.defaultTo("reviewing");

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();

			tenantReference(table, "client_id", "clients", "NO ACTION");
			tenantReference(table, "artist_id", "artists", "NO ACTION");
			tenantReference(table, "inquiry_id", "inquiries", "NO ACTION");

			table.index(["tenant_id"]);
			table.index(["tenant_id", "status"]);
			table.index(["tenant_id", "artist_id"]);
			table.index(["tenant_id", "client_id"]);
			// The unique index below is partial, so it cannot serve the foreign
			// key's NO ACTION check; this plain one does.
			table.index(["tenant_id", "inquiry_id"]);
		});

		// An inquiry becomes at most one live project.
		this.schema.raw(
			"create unique index tattoo_projects_inquiry_live_unique on tattoo_projects (tenant_id, inquiry_id) where deleted_at is null and inquiry_id is not null",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
