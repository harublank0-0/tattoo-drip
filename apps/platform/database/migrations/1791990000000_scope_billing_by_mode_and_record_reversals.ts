import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Billing by mode, the plan of each paid period, and reversals (the
 * November 2026 audit; docs/payments-paybridgenp.md).
 *
 * - `billing_access_periods.livemode`: the mode of the invoice that granted
 *   the period, copied from it here, so access reads only the active mode's
 *   periods and a sandbox payment never counts once billing runs live.
 * - `billing_invoices.plan_id`, `billing_access_periods.plan_id`: the plan
 *   the invoice billed (PayBridgeNP's invoice `plan`), recorded the first
 *   time it is known, never the subscription's plan of the day. Existing
 *   rows stay null: nothing on record says which plan they billed.
 * - `billing_access_periods.revoked_at` / `revoked_reason` /
 *   `revoked_by_user_id`: a period whose invoice was reversed counts only
 *   until then. Automatic reasons are the invoice's own statuses (`void`,
 *   `uncollectible`, `write_off`); staff end a period for a `refund`, a
 *   `chargeback` or an `other` reason (PayBridgeNP shows no refund on an
 *   invoice). The row stays.
 * - `billing_access_periods_guard`: what was append-only by convention is
 *   now enforced. An UPDATE may set the revocation once and change nothing
 *   else; the staff member may become null only once their user row is gone
 *   (ON DELETE SET NULL). Like payments_guard it fails closed, so a column
 *   added later is frozen until its migration frees it. UPDATE only: a
 *   tenant purge still cascades.
 * - `billing_subscriptions_one_live` is per studio and mode: a sandbox
 *   subscription left from testing no longer blocks the live one.
 */
const GUARD = `
create or replace function billing_access_periods_guard() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
	free text[] := array['revoked_at', 'revoked_reason', 'revoked_by_user_id'];
	changed text;
begin
	select n.key into changed
		from jsonb_each(to_jsonb(new)) as n(key, value)
		where n.key <> all (free) and n.value is distinct from (to_jsonb(old) -> n.key)
		limit 1;
	if changed is not null then
		raise exception 'billing_access_periods_guard: % cannot change', changed;
	end if;
	if old.revoked_at is not null
		and (new.revoked_at, new.revoked_reason) is distinct from (old.revoked_at, old.revoked_reason) then
		raise exception 'billing_access_periods_guard: a revocation is final';
	end if;
	-- Who ended it may only become null, and only once that user row is gone
	-- (ON DELETE SET NULL runs after the delete). Schema-qualified because
	-- the search_path is pinned.
	if old.revoked_at is not null
		and new.revoked_by_user_id is distinct from old.revoked_by_user_id
		and (new.revoked_by_user_id is not null
			or exists (select 1 from public.users where id = old.revoked_by_user_id)) then
		raise exception 'billing_access_periods_guard: a revocation is final';
	end if;
	return new;
end
$$`;

const ENDED = "('incomplete_expired', 'cancelled', 'completed')";

export default class extends BaseSchema {
	async up() {
		this.schema.alterTable("billing_invoices", (table) => {
			table
				.uuid("plan_id")
				.nullable()
				.references("id")
				.inTable("billing_plans")
				.onDelete("RESTRICT");
			table.index(["plan_id"]);
		});

		this.schema.alterTable("billing_access_periods", (table) => {
			table.boolean("livemode").nullable();
			table
				.uuid("plan_id")
				.nullable()
				.references("id")
				.inTable("billing_plans")
				.onDelete("RESTRICT");
			table.timestamp("revoked_at", { useTz: true }).nullable();
			table.string("revoked_reason", 32).nullable();
			table
				.uuid("revoked_by_user_id")
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL");
			table.index(["plan_id"]);
			table.index(["revoked_by_user_id"]);
		});
		for (const statement of [
			// Every period came from one invoice, whose mode it takes.
			`update billing_access_periods p set livemode = i.livemode
			 from billing_invoices i where i.id = p.invoice_id and i.tenant_id = p.tenant_id`,
			"alter table billing_access_periods alter column livemode set not null",
			"drop index billing_access_periods_tenant_id_ends_at_index",
			"create index billing_access_periods_tenant_id_livemode_ends_at_index on billing_access_periods (tenant_id, livemode, ends_at)",
			"alter table billing_access_periods add constraint billing_access_periods_revoked_reason check (revoked_reason in ('void', 'uncollectible', 'write_off', 'refund', 'chargeback', 'other'))",
			"alter table billing_access_periods add constraint billing_access_periods_revocation check ((revoked_at is null) = (revoked_reason is null) and (revoked_by_user_id is null or revoked_at is not null))",
			GUARD,
			"create trigger billing_access_periods_guard before update on billing_access_periods for each row execute function billing_access_periods_guard()",
			"drop index billing_subscriptions_one_live",
			`create unique index billing_subscriptions_one_live on billing_subscriptions (tenant_id, livemode) where status not in ${ENDED}`,
		]) {
			this.schema.raw(statement);
		}
	}

	async down() {
		for (const statement of [
			`do $$ begin
				if exists (
					select tenant_id from billing_subscriptions
					where status not in ${ENDED}
					group by tenant_id having count(*) > 1
				) then
					raise exception 'a studio has a live subscription in each mode, which the old one-live index refuses: end one of them (or reset the development database) before rolling back';
				end if;
			end $$`,
			"drop index billing_subscriptions_one_live",
			`create unique index billing_subscriptions_one_live on billing_subscriptions (tenant_id) where status not in ${ENDED}`,
			"drop trigger billing_access_periods_guard on billing_access_periods",
			"drop function billing_access_periods_guard()",
			"drop index billing_access_periods_tenant_id_livemode_ends_at_index",
			"create index billing_access_periods_tenant_id_ends_at_index on billing_access_periods (tenant_id, ends_at)",
		]) {
			this.schema.raw(statement);
		}
		this.schema.raw(
			"alter table billing_access_periods drop constraint billing_access_periods_revocation, drop constraint billing_access_periods_revoked_reason",
		);
		this.schema.alterTable("billing_access_periods", (table) => {
			table.dropColumns(
				"livemode",
				"plan_id",
				"revoked_at",
				"revoked_reason",
				"revoked_by_user_id",
			);
		});
		this.schema.alterTable("billing_invoices", (table) => {
			table.dropColumn("plan_id");
		});
	}
}
