import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
} from "#database/helpers/tenant_rls";

/**
 * The public profiles of a tenant's artists (TAT-31). A profile may be
 * linked to a login; deleting the account only unlinks it. Row-level
 * security and the (tenant_id, id) key are added by enableTenantRls.
 */
export default class extends BaseSchema {
	protected tableName = "artists";

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
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL");
			table.string("name", 120).notNullable();
			table.string("slug", 63).notNullable();
			table.string("bio", 1000).nullable();
			table.string("photo_key", 255).nullable();
			table.integer("photo_width").nullable();
			table.integer("photo_height").nullable();
			table.boolean("visible").notNullable().defaultTo(true);
			table.boolean("accepting_inquiries").notNullable().defaultTo(true);
			table.string("closed_message", 300).nullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();

			table.index(["tenant_id"]);
			table.index(["user_id"]);
		});

		// A deleted profile frees its slug and its login.
		this.schema.raw(
			"create unique index artists_tenant_slug_live_unique on artists (tenant_id, slug) where deleted_at is null",
		);
		this.schema.raw(
			"create unique index artists_tenant_user_live_unique on artists (tenant_id, user_id) where user_id is not null and deleted_at is null",
		);
		this.schema.raw(
			"alter table artists add constraint artists_photo_all_or_none check ((photo_key is null) = (photo_width is null) and (photo_key is null) = (photo_height is null))",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
