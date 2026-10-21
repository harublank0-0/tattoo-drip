import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * The deposit-proof alert (TAT-88): a member's alert that a client sent a
 * deposit screenshot, naming the payment and its project. One composite key
 * makes the payment this studio's and that project's (the target is TAT-66's
 * payments_tenant_project_id_unique). One alert per member per payment, so
 * the alert job's `on conflict do nothing` makes a rerun add nothing; a new
 * screenshot is always a new payment (the deposit page takes one at a time
 * and payments_guard never replaces a proof). Payments are never deleted,
 * so the cascade only matters for a tenant purge. The kinds are ALERT_KINDS
 * in #modules/notifications/alerts, copied here, not imported. down()
 * deletes the deposit-proof alerts first: TAT-52's checks can't hold them.
 */
export default class extends BaseSchema {
	protected tableName = "staff_alerts";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table.uuid("project_id").nullable();
			table.uuid("payment_id").nullable();
		});
		for (const statement of [
			"alter table staff_alerts add constraint staff_alerts_payment_foreign foreign key (tenant_id, project_id, payment_id) references payments (tenant_id, project_id, id) on delete cascade",
			"alter table staff_alerts drop constraint staff_alerts_kind_check",
			"alter table staff_alerts add constraint staff_alerts_kind_check check (kind in ('new_inquiry', 'deposit_proof'))",
			"alter table staff_alerts drop constraint staff_alerts_subject_matches_kind",
			"alter table staff_alerts add constraint staff_alerts_subject_matches_kind check ((kind = 'new_inquiry') = (inquiry_id is not null) and (kind = 'deposit_proof') = (payment_id is not null) and (project_id is null) = (payment_id is null))",
			// One alert per member per payment.
			"alter table staff_alerts add constraint staff_alerts_user_id_payment_id_unique unique (user_id, payment_id)",
			// The composite key's index.
			"create index staff_alerts_tenant_id_project_id_payment_id_index on staff_alerts (tenant_id, project_id, payment_id)",
		]) {
			this.schema.raw(statement);
		}
	}

	async down() {
		for (const statement of [
			"delete from staff_alerts where kind = 'deposit_proof'",
			"drop index staff_alerts_tenant_id_project_id_payment_id_index",
			"alter table staff_alerts drop constraint staff_alerts_user_id_payment_id_unique",
			"alter table staff_alerts drop constraint staff_alerts_subject_matches_kind",
			"alter table staff_alerts add constraint staff_alerts_subject_matches_kind check ((kind = 'new_inquiry') = (inquiry_id is not null))",
			"alter table staff_alerts drop constraint staff_alerts_kind_check",
			"alter table staff_alerts add constraint staff_alerts_kind_check check (kind in ('new_inquiry'))",
			"alter table staff_alerts drop constraint staff_alerts_payment_foreign",
		]) {
			this.schema.raw(statement);
		}
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumn("payment_id");
			table.dropColumn("project_id");
		});
	}
}
