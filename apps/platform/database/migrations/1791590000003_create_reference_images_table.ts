import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * Images a client sends as references (TAT-37), private. Created with the
 * inquiry; `project_id` is filled in when the inquiry is accepted. A
 * project created directly has images with only `project_id`.
 */
export default class extends BaseSchema {
	protected tableName = "reference_images";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("inquiry_id").nullable();
			table.uuid("project_id").nullable();
			table.string("image_key", 255).notNullable();
			table.integer("width").notNullable();
			table.integer("height").notNullable();
			// Order within its inquiry, or within its project when it has none.
			table.smallint("position").notNullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();

			tenantReference(table, "inquiry_id", "inquiries", "NO ACTION");
			tenantReference(table, "project_id", "tattoo_projects", "NO ACTION");

			table.index(["tenant_id"]);
			table.index(["tenant_id", "inquiry_id"]);
			table.index(["tenant_id", "project_id"]);
		});

		this.schema.raw(
			"alter table reference_images add constraint reference_images_attached check (inquiry_id is not null or project_id is not null)",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
