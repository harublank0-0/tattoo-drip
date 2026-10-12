import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * The price of a project (TAT-37), versioned: a revision is a new row with
 * the next `version`, and the current quote is the project's highest
 * version. Quotes are history, so there is no `deleted_at`; by convention
 * the price, deposit and expiry never change after insert. Sending a quote
 * (`sent_at`) is TAT-64's.
 */
export default class extends BaseSchema {
	protected tableName = "quotes";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("project_id").notNullable();
			table.integer("version").notNullable();
			table.enum("kind", ["fixed", "hourly"]).notNullable();
			// Paisa. Which of the three is set depends on the kind.
			table.integer("fixed_price").nullable();
			table.integer("hourly_rate").nullable();
			// Whole minutes: Postgres returns numeric hours as a string, a trap for
			// money maths. The UI converts hours.
			table.integer("estimated_minutes").nullable();
			table.integer("deposit_amount").notNullable().defaultTo(0);
			table.string("currency", 3).notNullable().defaultTo("NPR");
			table.timestamp("expires_at", { useTz: true }).notNullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			tenantReference(table, "project_id", "tattoo_projects", "NO ACTION");

			table.index(["tenant_id"]);
			table.index(["tenant_id", "project_id"]);
		});

		this.schema.raw(
			"alter table quotes add constraint quotes_project_version_unique unique (project_id, version)",
		);
		this.schema.raw(
			"alter table quotes add constraint quotes_version_positive check (version >= 1)",
		);
		this.schema.raw(
			"alter table quotes add constraint quotes_kind_columns check ((kind = 'fixed' and fixed_price is not null and hourly_rate is null and estimated_minutes is null) or (kind = 'hourly' and fixed_price is null and hourly_rate is not null and estimated_minutes is not null))",
		);
		this.schema.raw(
			"alter table quotes add constraint quotes_amounts_positive check ((fixed_price is null or fixed_price > 0) and (hourly_rate is null or hourly_rate > 0) and (estimated_minutes is null or estimated_minutes > 0) and deposit_amount >= 0)",
		);
		// The deposit never exceeds the total: the price, or the rate for the
		// estimated minutes (rounded half away from zero, like Postgres' round).
		this.schema.raw(
			"alter table quotes add constraint quotes_deposit_within_total check (deposit_amount <= coalesce(fixed_price, round(hourly_rate * estimated_minutes / 60.0)))",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
