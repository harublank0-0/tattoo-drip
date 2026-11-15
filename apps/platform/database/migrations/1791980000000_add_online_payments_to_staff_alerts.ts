import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Online-payment alerts: a member's alert that PayBridgeNP reported a
 * client's online payment, either recorded as a deposit (`online_deposit`)
 * or held for review (`online_review`, which has no ledger row). Both name
 * the gateway payment and its project; one composite key makes the payment
 * this studio's and that project's (gateway_payments_project_unique). A
 * gateway payment is recorded or held, never both
 * (gateway_payments_recorded_or_review), so one alert per member per gateway
 * payment, and the alert job's `on conflict do nothing` makes a rerun add
 * nothing. Gateway payments are never deleted, so the cascade only matters
 * for a tenant purge. The kinds are ALERT_KINDS in
 * #modules/notifications/alerts, copied here, not imported. down() deletes
 * these alerts first: the older checks can't hold them.
 */
export default class extends BaseSchema {
	protected tableName = "staff_alerts";

	async up() {
		for (const statement of [
			"alter table staff_alerts add column gateway_payment_id uuid null",
			"alter table staff_alerts add constraint staff_alerts_gateway_payment_foreign foreign key (tenant_id, gateway_payment_id, project_id) references gateway_payments (tenant_id, id, project_id) on delete cascade",
			"create index staff_alerts_tenant_id_gateway_payment_id_index on staff_alerts (tenant_id, gateway_payment_id, project_id)",
			"alter table staff_alerts drop constraint staff_alerts_kind_check",
			"alter table staff_alerts add constraint staff_alerts_kind_check check (kind in ('new_inquiry', 'deposit_proof', 'fresh_ink', 'online_deposit', 'online_review'))",
			"alter table staff_alerts drop constraint staff_alerts_subject_matches_kind",
			"alter table staff_alerts add constraint staff_alerts_subject_matches_kind check ((kind = 'new_inquiry') = (inquiry_id is not null) and (kind = 'deposit_proof') = (payment_id is not null) and (kind = 'fresh_ink') = (post_id is not null) and (kind in ('online_deposit', 'online_review')) = (gateway_payment_id is not null) and (post_id is null) = (post_round is null) and (project_id is null) = (payment_id is null and gateway_payment_id is null))",
			// One alert per member per gateway payment.
			"alter table staff_alerts add constraint staff_alerts_user_gateway_payment_unique unique (user_id, gateway_payment_id)",
		]) {
			this.schema.raw(statement);
		}
	}

	async down() {
		for (const statement of [
			"delete from staff_alerts where kind in ('online_deposit', 'online_review')",
			"alter table staff_alerts drop constraint staff_alerts_user_gateway_payment_unique",
			"alter table staff_alerts drop constraint staff_alerts_subject_matches_kind",
			"alter table staff_alerts add constraint staff_alerts_subject_matches_kind check ((kind = 'new_inquiry') = (inquiry_id is not null) and (kind = 'deposit_proof') = (payment_id is not null) and (kind = 'fresh_ink') = (post_id is not null) and (post_id is null) = (post_round is null) and (project_id is null) = (payment_id is null))",
			"alter table staff_alerts drop constraint staff_alerts_kind_check",
			"alter table staff_alerts add constraint staff_alerts_kind_check check (kind in ('new_inquiry', 'deposit_proof', 'fresh_ink'))",
			"drop index staff_alerts_tenant_id_gateway_payment_id_index",
			"alter table staff_alerts drop constraint staff_alerts_gateway_payment_foreign",
			"alter table staff_alerts drop column gateway_payment_id",
		]) {
			this.schema.raw(statement);
		}
	}
}
