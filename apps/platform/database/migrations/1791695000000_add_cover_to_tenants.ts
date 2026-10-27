import { BaseSchema } from "@adonisjs/lucid/schema";

/** The studio's cover photo (TAT-116): the public studio_cover image, all three columns or none. */
export default class extends BaseSchema {
	protected tableName = "tenants";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table.string("cover_image_key", 255).nullable();
			table.integer("cover_image_width").nullable();
			table.integer("cover_image_height").nullable();
		});
		this.schema.raw(
			"alter table tenants add constraint tenants_cover_all_or_none check ((cover_image_key is null) = (cover_image_width is null) and (cover_image_key is null) = (cover_image_height is null))",
		);
	}

	async down() {
		this.schema.raw(
			"alter table tenants drop constraint tenants_cover_all_or_none",
		);
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumns(
				"cover_image_key",
				"cover_image_width",
				"cover_image_height",
			);
		});
	}
}
