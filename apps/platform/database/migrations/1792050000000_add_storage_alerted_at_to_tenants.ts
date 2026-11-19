import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * The storage meter's 95% email (step 3): when the studio's owners were
 * last emailed that its storage is nearly full. Set once per crossing by
 * StorageAlertJob (`update … where storage_alerted_at is null returning`),
 * cleared when usage falls below 90%, so a later crossing emails again.
 */
export default class extends BaseSchema {
	async up() {
		this.schema.alterTable("tenants", (table) => {
			table.timestamp("storage_alerted_at", { useTz: true }).nullable();
		});
	}

	async down() {
		this.schema.alterTable("tenants", (table) => {
			table.dropColumn("storage_alerted_at");
		});
	}
}
