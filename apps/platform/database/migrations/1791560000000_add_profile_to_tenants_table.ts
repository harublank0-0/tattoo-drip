import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * The studio's public profile and deposit defaults (TAT-26).
 */
export default class extends BaseSchema {
	protected tableName = "tenants";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table.string("intro", 1000).nullable();
			// E.164, e.g. +9779812345678 (see database/README.md).
			table.string("contact_phone", 16).nullable();
			table.string("contact_email", 254).nullable();
			table.string("address", 300).nullable();
			table.string("instagram_url", 500).nullable();
			table.string("facebook_url", 500).nullable();
			table.string("tiktok_url", 500).nullable();
			table.string("website_url", 500).nullable();
			// Null: no default; the artist sets the deposit on each quote.
			table
				.smallint("default_deposit_percent")
				.nullable()
				.checkBetween([0, 100], "tenants_default_deposit_percent_range");
			table.string("deposit_policy", 2000).nullable();
		});
	}

	async down() {
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumns(
				"intro",
				"contact_phone",
				"contact_email",
				"address",
				"instagram_url",
				"facebook_url",
				"tiktok_url",
				"website_url",
				"default_deposit_percent",
				"deposit_policy",
			);
		});
	}
}
