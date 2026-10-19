import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * What happened to a deposit (TAT-66): the studio kept it, moved it to a new
 * date or refunded it, when a project closed holding deposit money (no
 * session) or, from TAT-85, when a session was missed or cancelled. The app
 * only records what the studio decided; its deposit policy is its own.
 * `amount` is the deposit money held when it was recorded; a refund is a
 * real `refund` payment of the same project, named here. One outcome per
 * project close and one per session. Not soft-deleted and append-only by
 * convention (PaymentService only inserts): the money itself is a guarded
 * payment.
 */
export default class extends BaseSchema {
	protected tableName = "deposit_outcomes";

	async up() {
		// The target of the session's composite key: a session of this project.
		this.schema.raw(
			"alter table project_sessions add constraint project_sessions_tenant_project_id_unique unique (tenant_id, project_id, id)",
		);
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("project_id").notNullable();
			table.uuid("session_id").nullable();
			table.enum("outcome", ["kept", "moved", "refunded"]).notNullable();
			// Paisa: the deposit money held when the outcome was recorded. A
			// bigint: it is a sum of deposits (desk deposits can pile up while a
			// project waits for a session), which passes int4 where each payment
			// does not. node-pg returns int8 as a string; DepositOutcome reads it
			// as a number.
			table.bigInteger("amount").notNullable();
			table.string("currency", 3).notNullable().defaultTo("NPR");
			table.uuid("refund_payment_id").nullable();
			table.string("note", 500).nullable();
			table
				.uuid("recorded_by_user_id")
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL");

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			tenantReference(table, "project_id", "tattoo_projects", "NO ACTION");

			table.index(["tenant_id"]);
			table.index(["tenant_id", "project_id"]);
			table.index(["recorded_by_user_id"]);
		});
		for (const statement of [
			"alter table deposit_outcomes add constraint deposit_outcomes_session_foreign foreign key (tenant_id, project_id, session_id) references project_sessions (tenant_id, project_id, id) on delete no action",
			"alter table deposit_outcomes add constraint deposit_outcomes_refund_payment_foreign foreign key (tenant_id, project_id, refund_payment_id) references payments (tenant_id, project_id, id) on delete no action",
			"alter table deposit_outcomes add constraint deposit_outcomes_amount_positive check (amount > 0)",
			"alter table deposit_outcomes add constraint deposit_outcomes_refund_matches check ((outcome = 'refunded') = (refund_payment_id is not null))",
			"alter table deposit_outcomes add constraint deposit_outcomes_moved_needs_session check (outcome <> 'moved' or session_id is not null)",
			"create unique index deposit_outcomes_project_close_unique on deposit_outcomes (tenant_id, project_id) where session_id is null",
			"create unique index deposit_outcomes_session_unique on deposit_outcomes (session_id) where session_id is not null",
			"create unique index deposit_outcomes_refund_payment_unique on deposit_outcomes (refund_payment_id)",
			...enableTenantRls(this.tableName),
		]) {
			this.schema.raw(statement);
		}
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
		this.schema.raw(
			"alter table project_sessions drop constraint project_sessions_tenant_project_id_unique",
		);
	}
}
