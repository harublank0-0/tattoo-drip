import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * An artist's tattoo styles and social links (TAT-125).
 * `styles` holds slugs from the list in #modules/artists/styles, at most
 * five (the list itself is not checked here, so a style can leave it without
 * a migration). The links are https URLs; the form checks them.
 */
export default class extends BaseSchema {
	protected tableName = "artists";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table
				.specificType("styles", "varchar(40)[]")
				.notNullable()
				.defaultTo(this.raw("'{}'"));
			table.string("instagram_url", 500).nullable();
			table.string("facebook_url", 500).nullable();
			table.string("tiktok_url", 500).nullable();
		});
		this.schema.raw(
			"alter table artists add constraint artists_styles_max check (cardinality(styles) <= 5)",
		);
	}

	async down() {
		this.schema.raw("alter table artists drop constraint artists_styles_max");
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumns(
				"styles",
				"instagram_url",
				"facebook_url",
				"tiktok_url",
			);
		});
	}
}
