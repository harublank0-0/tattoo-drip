import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * TattooDrip's own subscription billing through PayBridgeNP Billing
 * (docs/payments-paybridgenp.md): what each studio pays TattooDrip. Nothing
 * here is a studio's customer money.
 *
 * - `billing_plans`: platform reference data (no tenant), the plan
 *   catalogue mirrored to PayBridgeNP once per mode (`billing:sync-plans`).
 * - `billing_customers`: a studio as PayBridgeNP's billing customer, one per
 *   mode. `provider_customer_id` is unique: webhooks find the studio by it
 *   (billing_tenant_for_customer in the next migration).
 * - `billing_subscriptions`, `billing_invoices`: local copies of the
 *   provider's records, refreshed from its API (never from a webhook body).
 *   One live subscription per studio (a partial unique on the statuses that
 *   can still bill).
 * - `billing_access_periods`: paid access, one row per paid invoice and only
 *   once that invoice is confirmed paid with the API. Append-only by
 *   convention: a period is never changed or removed.
 * - `billing_events`: every webhook event received, by PayBridgeNP's event
 *   id (unique), so a repeated delivery is processed once.
 *
 * Money is integer paisa with a currency. Every tenant-owned table runs
 * enableTenantRls().
 */
export default class extends BaseSchema {
	async up() {
		this.schema.createTable("billing_plans", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table.string("code", 64).notNullable();
			table.string("name", 120).notNullable();
			table.integer("amount").notNullable();
			table.string("currency", 3).notNullable().defaultTo("NPR");
			table.string("interval_unit", 16).notNullable();
			table.integer("interval_count").notNullable();
			table.integer("trial_days").notNullable().defaultTo(0);
			table.boolean("livemode").notNullable();
			table.string("provider_plan_id", 64).nullable().unique();
			table.boolean("active").notNullable().defaultTo(true);
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.unique(["code", "livemode"]);
		});
		this.schema.raw(
			"alter table billing_plans add constraint billing_plans_amount check (amount > 0)",
		);
		this.schema.raw(
			"alter table billing_plans add constraint billing_plans_interval check (interval_unit in ('day', 'week', 'month', 'quarter', 'year') and interval_count > 0)",
		);

		this.schema.createTable("billing_customers", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.boolean("livemode").notNullable();
			table.string("provider_customer_id", 64).notNullable().unique();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.unique(["tenant_id", "livemode"]);
		});
		for (const sql of enableTenantRls("billing_customers"))
			this.schema.raw(sql);

		this.schema.createTable("billing_subscriptions", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("customer_id").notNullable();
			table
				.uuid("plan_id")
				.nullable()
				.references("id")
				.inTable("billing_plans")
				.onDelete("RESTRICT");
			table
				.uuid("pending_plan_id")
				.nullable()
				.references("id")
				.inTable("billing_plans")
				.onDelete("RESTRICT");
			table.string("provider_subscription_id", 64).notNullable().unique();
			table.string("status", 32).notNullable();
			table.boolean("livemode").notNullable();
			table.timestamp("current_period_start", { useTz: true }).nullable();
			table.timestamp("current_period_end", { useTz: true }).nullable();
			table.timestamp("next_invoice_at", { useTz: true }).nullable();
			table.timestamp("trial_ends_at", { useTz: true }).nullable();
			table.boolean("cancel_at_period_end").notNullable().defaultTo(false);
			table.timestamp("canceled_at", { useTz: true }).nullable();
			table.timestamp("cancel_effective_at", { useTz: true }).nullable();
			table.timestamp("ended_at", { useTz: true }).nullable();
			table.timestamp("paused_at", { useTz: true }).nullable();
			table.timestamp("synced_at", { useTz: true }).nullable();
			table
				.uuid("created_by_user_id")
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL");
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			tenantReference(table, "customer_id", "billing_customers", "RESTRICT");
			table.index(["tenant_id", "created_at"]);
			table.index(["plan_id"]);
			table.index(["pending_plan_id"]);
			table.index(["created_by_user_id"]);
		});
		for (const sql of enableTenantRls("billing_subscriptions"))
			this.schema.raw(sql);
		// PayBridgeNP's display statuses; an unknown new one is refused loudly
		// rather than misread (the adapter maps it to null first).
		this.schema.raw(
			"alter table billing_subscriptions add constraint billing_subscriptions_status check (status in ('incomplete', 'incomplete_expired', 'draft', 'trialing', 'active', 'past_due', 'paused', 'cancelled', 'completed'))",
		);
		this.schema.raw(
			"create unique index billing_subscriptions_one_live on billing_subscriptions (tenant_id) where status not in ('incomplete_expired', 'cancelled', 'completed')",
		);

		this.schema.createTable("billing_invoices", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("subscription_id").notNullable();
			table.string("provider_invoice_id", 64).notNullable().unique();
			table.string("number", 64).nullable();
			table.string("status", 32).notNullable();
			table.integer("amount_due").notNullable();
			table.integer("amount_paid").notNullable().defaultTo(0);
			table.string("currency", 3).notNullable().defaultTo("NPR");
			table.timestamp("issued_at", { useTz: true }).nullable();
			table.timestamp("due_at", { useTz: true }).nullable();
			table.timestamp("paid_at", { useTz: true }).nullable();
			// The billing period, stored the first time the invoice is read
			// and never changed (see docs/payments-paybridgenp.md).
			table.timestamp("period_start", { useTz: true }).nullable();
			table.timestamp("period_end", { useTz: true }).nullable();
			table.string("hosted_invoice_url", 2048).nullable();
			table.boolean("livemode").notNullable();
			table.timestamp("synced_at", { useTz: true }).nullable();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			tenantReference(
				table,
				"subscription_id",
				"billing_subscriptions",
				"RESTRICT",
			);
			table.index(["tenant_id", "created_at"]);
			table.index(["tenant_id", "status"]);
			table.index(["tenant_id", "subscription_id"]);
			table.index(["paid_at"]);
		});
		for (const sql of enableTenantRls("billing_invoices")) this.schema.raw(sql);
		this.schema.raw(
			"alter table billing_invoices add constraint billing_invoices_status check (status in ('draft', 'open', 'paid', 'overdue', 'void', 'uncollectible', 'write_off'))",
		);
		this.schema.raw(
			"alter table billing_invoices add constraint billing_invoices_amounts check (amount_due >= 0 and amount_paid >= 0)",
		);

		this.schema.createTable("billing_access_periods", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("invoice_id").notNullable();
			table.timestamp("starts_at", { useTz: true }).notNullable();
			table.timestamp("ends_at", { useTz: true }).notNullable();
			table.timestamp("created_at", { useTz: true }).notNullable();

			tenantReference(table, "invoice_id", "billing_invoices", "RESTRICT");
			table.unique(["invoice_id"]);
			table.index(["tenant_id", "ends_at"]);
		});
		for (const sql of enableTenantRls("billing_access_periods"))
			this.schema.raw(sql);
		this.schema.raw(
			"alter table billing_access_periods add constraint billing_access_periods_order check (ends_at > starts_at)",
		);

		this.schema.createTable("billing_events", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.string("provider_event_id", 64).notNullable().unique();
			table.string("type", 64).notNullable();
			table.boolean("livemode").notNullable();
			table.string("object_id", 64).nullable();
			table.timestamp("occurred_at", { useTz: true }).nullable();
			table.timestamp("received_at", { useTz: true }).notNullable();
			table.timestamp("processed_at", { useTz: true }).nullable();
			table.index(["tenant_id", "received_at"]);
		});
		for (const sql of enableTenantRls("billing_events")) this.schema.raw(sql);
	}

	async down() {
		for (const table of [
			"billing_events",
			"billing_access_periods",
			"billing_invoices",
			"billing_subscriptions",
			"billing_customers",
		]) {
			for (const sql of disableTenantRls(table)) this.schema.raw(sql);
			this.schema.dropTable(table);
		}
		this.schema.dropTable("billing_plans");
	}
}
