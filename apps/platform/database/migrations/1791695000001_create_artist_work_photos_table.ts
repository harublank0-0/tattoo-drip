import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * Up to six public photos of an artist's work (TAT-116), in the studio's
 * order. Not soft-deleted: removing a photo deletes the row and its files.
 * The position check and the deferrable unique position hold the limit of
 * six in the database; deferrable so a swap or a compaction is one UPDATE.
 */
export default class extends BaseSchema {
	protected tableName = "artist_work_photos";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("artist_id").notNullable();
			table.string("image_key", 255).notNullable();
			table.integer("width").notNullable();
			table.integer("height").notNullable();
			table.smallint("position").notNullable();
			table.string("alt", 200).nullable();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			// A purged artist takes its photo rows (soft deletes never reach here).
			tenantReference(table, "artist_id", "artists");
			table.index(["tenant_id"]);
		});
		this.schema.raw(
			"alter table artist_work_photos add constraint artist_work_photos_position_range check (position between 0 and 5)",
		);
		this.schema.raw(
			"alter table artist_work_photos add constraint artist_work_photos_size check (width > 0 and height > 0)",
		);
		this.schema.raw(
			"alter table artist_work_photos add constraint artist_work_photos_position_unique unique (tenant_id, artist_id, position) deferrable initially immediate",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
