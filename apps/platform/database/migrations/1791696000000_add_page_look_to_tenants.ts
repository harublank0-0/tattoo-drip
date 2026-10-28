import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * A studio's page look (TAT-56): theme, shown sections, two accent colours,
 * the heading font and the logo, as columns of tenants (like the cover), so
 * the public read and the settings page cost no query. The database checks
 * only the shapes; which theme, font and section keys exist is the app's list
 * (#modules/storefront/look), so a new theme needs no migration. Sections are
 * the visible ones in order, as a comma list that always holds `inquiry`.
 */
export default class extends BaseSchema {
	protected tableName = "tenants";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table
				.string("storefront_theme", 40)
				.notNullable()
				.defaultTo("stencil-and-ink");
			table
				.string("storefront_sections", 100)
				.notNullable()
				.defaultTo("artists,inquiry");
			table.string("brand_accent", 7).nullable();
			table.string("brand_accent_dark", 7).nullable();
			table.string("brand_font", 20).notNullable().defaultTo("eczar");
			table.string("logo_image_key", 255).nullable();
			table.integer("logo_image_width").nullable();
			table.integer("logo_image_height").nullable();
		});
		this.schema.raw(
			"alter table tenants add constraint tenants_storefront_theme_format check (storefront_theme ~ '^[a-z][a-z0-9-]{0,39}$')",
		);
		this.schema.raw(
			"alter table tenants add constraint tenants_brand_font_format check (brand_font ~ '^[a-z][a-z0-9-]{0,19}$')",
		);
		this.schema.raw(
			"alter table tenants add constraint tenants_storefront_sections_format check (storefront_sections ~ '^[a-z]+(,[a-z]+){0,7}$' and 'inquiry' = any (string_to_array(storefront_sections, ',')))",
		);
		this.schema.raw(
			"alter table tenants add constraint tenants_brand_accent_format check (brand_accent ~ '^#[0-9a-f]{6}$')",
		);
		this.schema.raw(
			"alter table tenants add constraint tenants_brand_accent_dark_format check (brand_accent_dark ~ '^#[0-9a-f]{6}$')",
		);
		this.schema.raw(
			"alter table tenants add constraint tenants_logo_all_or_none check ((logo_image_key is null) = (logo_image_width is null) and (logo_image_key is null) = (logo_image_height is null))",
		);
	}

	async down() {
		for (const name of [
			"tenants_logo_all_or_none",
			"tenants_brand_accent_dark_format",
			"tenants_brand_accent_format",
			"tenants_storefront_sections_format",
			"tenants_brand_font_format",
			"tenants_storefront_theme_format",
		]) {
			this.schema.raw(`alter table tenants drop constraint ${name}`);
		}
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumns(
				"storefront_theme",
				"storefront_sections",
				"brand_accent",
				"brand_accent_dark",
				"brand_font",
				"logo_image_key",
				"logo_image_width",
				"logo_image_height",
			);
		});
	}
}
