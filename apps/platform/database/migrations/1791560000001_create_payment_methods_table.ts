import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * The ways a studio gets paid (TAT-26). Which fields each kind needs is
 * checked by PaymentMethodService, not here.
 */
export default class extends BaseSchema {
	protected tableName = "payment_methods";

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
				.enum("kind", ["fonepay", "esewa", "khalti", "bank", "cash"])
				.notNullable();
			table.string("label", 80).notNullable();
			table.string("account_name", 120).nullable();
			// The bank account number, or the eSewa/Khalti wallet ID.
			table.string("account_number", 64).nullable();
			table.string("bank_name", 120).nullable();
			table.string("qr_image_key", 255).nullable();
			table.boolean("show_on_deposit_page").notNullable().defaultTo(false);
			table.integer("position").notNullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();

			// A tenant's methods, in the owner's order.
			table.index(["tenant_id", "position"]);
		});
	}

	async down() {
		this.schema.dropTable(this.tableName);
	}
}
