import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * A studio's own online payments through its own PayBridgeNP project
 * (docs/payments-paybridgenp.md). The money is the studio's: it settles to
 * the studio's provider accounts, never TattooDrip's.
 *
 * - `gateway_accounts`: the studio's connection. Its secret key and its
 *   webhook signing secret are stored sealed (AES-256-GCM with
 *   PAYMENT_CREDENTIALS_KEY, bound to the row's id), never in plain text.
 *   `webhook_key` is the random path segment of the studio's webhook URL
 *   (unique: the webhook finds the studio by it). One live connection per
 *   studio. Not soft-deleted: a disconnected one keeps `disconnected_at` so
 *   the payments it took still name it.
 * - `gateway_checkouts`: one hosted checkout session per attempt. The
 *   amount is fixed when the session is created from the database's own
 *   figures and is what a payment must match. `idempotency_key` is stored
 *   before the API call, so a retry repeats the same request. One open
 *   attempt per project.
 * - `gateway_payments`: every provider payment reported for a checkout,
 *   unique by PayBridgeNP's payment id. `payment_id` is the ledger row it
 *   was recorded as (once, unique); `review_reason` marks one that was not
 *   recorded because it did not match (amount, currency, mode, session,
 *   metadata), was a second success for one checkout, or came too late.
 * - `gateway_refunds`: refunds PayBridgeNP reports, unique by its refund
 *   id; a succeeded one is recorded once as a negative ledger `refund`.
 * - `gateway_events`: every webhook event received, unique per connection
 *   and PayBridgeNP event id.
 */
export default class extends BaseSchema {
	async up() {
		this.schema.createTable("gateway_accounts", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.string("provider", 16).notNullable().defaultTo("paybridgenp");
			table.boolean("livemode").notNullable();
			table.text("secret_key_sealed").notNullable();
			table.string("key_hint", 16).notNullable();
			table.string("webhook_key", 64).notNullable().unique();
			table.text("webhook_secret_sealed").nullable();
			table.string("provider_webhook_id", 64).nullable();
			table.string("provider_merchant_id", 64).notNullable();
			table.string("provider_merchant_name", 200).notNullable();
			table.string("provider_project_id", 64).notNullable();
			table.string("provider_project_name", 200).notNullable();
			table.string("status", 16).notNullable().defaultTo("pending");
			table.timestamp("verified_at", { useTz: true }).nullable();
			table
				.uuid("verified_by_user_id")
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL");
			table
				.uuid("connected_by_user_id")
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL");
			table.timestamp("disconnected_at", { useTz: true }).nullable();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.index(["tenant_id"]);
			table.index(["verified_by_user_id"]);
			table.index(["connected_by_user_id"]);
		});
		for (const sql of enableTenantRls("gateway_accounts")) this.schema.raw(sql);
		this.schema.raw(
			"alter table gateway_accounts add constraint gateway_accounts_status check (status in ('pending', 'verified', 'suspended'))",
		);
		this.schema.raw(
			"alter table gateway_accounts add constraint gateway_accounts_verified check ((status = 'verified') = (verified_at is not null))",
		);
		this.schema.raw(
			"create unique index gateway_accounts_one_live on gateway_accounts (tenant_id) where disconnected_at is null",
		);

		this.schema.createTable("gateway_checkouts", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("account_id").notNullable();
			table.uuid("project_id").notNullable();
			table.string("purpose", 16).notNullable().defaultTo("deposit");
			table.integer("amount").notNullable();
			table.string("currency", 3).notNullable().defaultTo("NPR");
			table.boolean("livemode").notNullable();
			table.uuid("idempotency_key").notNullable().unique();
			table.string("provider_session_id", 64).nullable().unique();
			table.string("checkout_url", 2048).nullable();
			table.string("status", 16).notNullable().defaultTo("creating");
			table.timestamp("expires_at", { useTz: true }).nullable();
			table.string("failure_reason", 500).nullable();
			table.timestamp("last_synced_at", { useTz: true }).nullable();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			tenantReference(table, "account_id", "gateway_accounts", "RESTRICT");
			tenantReference(table, "project_id", "tattoo_projects", "NO ACTION");
			table.index(["tenant_id", "created_at"]);
			table.index(["tenant_id", "status"]);
			table.index(["tenant_id", "project_id"]);
			table.index(["account_id"]);
		});
		for (const sql of enableTenantRls("gateway_checkouts"))
			this.schema.raw(sql);
		this.schema.raw(
			"alter table gateway_checkouts add constraint gateway_checkouts_status check (status in ('creating', 'open', 'paid', 'failed', 'cancelled', 'expired', 'superseded'))",
		);
		this.schema.raw(
			"alter table gateway_checkouts add constraint gateway_checkouts_purpose check (purpose in ('deposit'))",
		);
		// PayBridgeNP's checkout bounds: NPR 10 to NPR 1,000,000.
		this.schema.raw(
			"alter table gateway_checkouts add constraint gateway_checkouts_amount check (amount between 1000 and 100000000 and currency = 'NPR')",
		);
		// An attempt that never reached PayBridgeNP has no session: it stays
		// `creating`, or ends `failed` or `superseded`.
		this.schema.raw(
			"alter table gateway_checkouts add constraint gateway_checkouts_session check (status in ('creating', 'failed', 'superseded') or provider_session_id is not null)",
		);
		// The target of the payments' key: a payment names its checkout's project.
		this.schema.raw(
			"alter table gateway_checkouts add constraint gateway_checkouts_project_unique unique (tenant_id, id, project_id)",
		);
		this.schema.raw(
			"create unique index gateway_checkouts_one_open on gateway_checkouts (tenant_id, project_id) where status in ('creating', 'open')",
		);

		this.schema.createTable("gateway_payments", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("checkout_id").notNullable();
			table.uuid("project_id").notNullable();
			table.string("provider_payment_id", 64).notNullable().unique();
			table.string("status", 16).notNullable();
			table.string("method", 16).nullable();
			table.string("provider_ref", 128).nullable();
			table.integer("amount").notNullable();
			table.string("currency", 3).notNullable();
			table.boolean("livemode").notNullable();
			table.integer("refunded_amount").notNullable().defaultTo(0);
			table.uuid("payment_id").nullable().unique();
			table.string("review_reason", 32).nullable();
			table.string("failure_reason", 500).nullable();
			table.timestamp("paid_at", { useTz: true }).nullable();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			table.index(["tenant_id", "created_at"]);
			table.index(["tenant_id", "status"]);
			table.index(["tenant_id", "checkout_id"]);
		});
		for (const sql of enableTenantRls("gateway_payments")) this.schema.raw(sql);
		this.schema.raw(
			"alter table gateway_payments add constraint gateway_payments_checkout_fk foreign key (tenant_id, checkout_id, project_id) references gateway_checkouts (tenant_id, id, project_id) on delete restrict",
		);
		this.schema.raw(
			"alter table gateway_payments add constraint gateway_payments_project_unique unique (tenant_id, id, project_id)",
		);
		this.schema.raw(
			"alter table gateway_payments add constraint gateway_payments_ledger_fk foreign key (tenant_id, project_id, payment_id) references payments (tenant_id, project_id, id) on delete no action",
		);
		this.schema.raw(
			"alter table gateway_payments add constraint gateway_payments_status check (status in ('pending', 'processing', 'success', 'failed', 'cancelled', 'refunded'))",
		);
		this.schema.raw(
			"alter table gateway_payments add constraint gateway_payments_method check (method is null or method in ('esewa', 'khalti', 'fonepay', 'card'))",
		);
		this.schema.raw(
			"alter table gateway_payments add constraint gateway_payments_review check (review_reason is null or review_reason in ('amount_mismatch', 'currency_mismatch', 'mode_mismatch', 'session_mismatch', 'metadata_mismatch', 'duplicate', 'unsupported_method', 'project_deleted'))",
		);
		// Recorded in the ledger, or held for review: never both.
		this.schema.raw(
			"alter table gateway_payments add constraint gateway_payments_recorded_or_review check (payment_id is null or review_reason is null)",
		);
		this.schema.raw(
			"alter table gateway_payments add constraint gateway_payments_amounts check (amount >= 0 and refunded_amount >= 0)",
		);

		this.schema.createTable("gateway_refunds", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("gateway_payment_id").notNullable();
			table.uuid("project_id").notNullable();
			table.string("provider_refund_id", 64).notNullable().unique();
			table.integer("amount").notNullable();
			table.string("currency", 3).notNullable();
			table.string("status", 24).notNullable();
			table.string("failure_reason", 500).nullable();
			table.uuid("payment_id").nullable().unique();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			table.index(["tenant_id", "created_at"]);
			table.index(["tenant_id", "gateway_payment_id"]);
		});
		for (const sql of enableTenantRls("gateway_refunds")) this.schema.raw(sql);
		this.schema.raw(
			"alter table gateway_refunds add constraint gateway_refunds_payment_fk foreign key (tenant_id, gateway_payment_id, project_id) references gateway_payments (tenant_id, id, project_id) on delete restrict",
		);
		this.schema.raw(
			"alter table gateway_refunds add constraint gateway_refunds_ledger_fk foreign key (tenant_id, project_id, payment_id) references payments (tenant_id, project_id, id) on delete no action",
		);
		this.schema.raw(
			"alter table gateway_refunds add constraint gateway_refunds_status check (status in ('processing', 'succeeded', 'failed', 'requires_action'))",
		);
		this.schema.raw(
			"alter table gateway_refunds add constraint gateway_refunds_amount check (amount > 0)",
		);

		this.schema.createTable("gateway_events", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("account_id").notNullable();
			table.string("provider_event_id", 64).notNullable();
			table.string("type", 64).notNullable();
			table.boolean("livemode").notNullable();
			table.string("object_id", 64).nullable();
			table.timestamp("occurred_at", { useTz: true }).nullable();
			table.timestamp("received_at", { useTz: true }).notNullable();
			table.timestamp("processed_at", { useTz: true }).nullable();

			tenantReference(table, "account_id", "gateway_accounts", "RESTRICT");
			table.unique(["account_id", "provider_event_id"]);
			table.index(["tenant_id", "received_at"]);
		});
		for (const sql of enableTenantRls("gateway_events")) this.schema.raw(sql);
	}

	async down() {
		for (const table of [
			"gateway_events",
			"gateway_refunds",
			"gateway_payments",
			"gateway_checkouts",
			"gateway_accounts",
		]) {
			for (const sql of disableTenantRls(table)) this.schema.raw(sql);
			this.schema.dropTable(table);
		}
	}
}
