import { BaseSchema } from "@adonisjs/lucid/schema";
import env from "#start/env";

/**
 * The narrow ways across tenants that payments need (database/README.md,
 * SECURITY DEFINER functions): ids only, each an exact lookup on one unique
 * column or a fixed listing with no arguments, an SQL-standard body, a
 * pinned search_path, schema-qualified names, no EXECUTE for PUBLIC.
 *
 * - billing_tenant_for_customer(requested_customer): the live studio whose
 *   PayBridgeNP billing customer id is exactly the argument. A signed
 *   platform webhook names a customer; its processing then runs in that
 *   studio's context only.
 * - gateway_tenant_for_webhook(requested_key): the live studio whose
 *   payment connection has exactly this webhook path key. The delivery's
 *   signature is then checked with that connection's own secret, in that
 *   studio's context, before anything else is read.
 * - billing_tenants(): live studios with a billing customer, for the
 *   daily reconciliation and the admin's Billing page, each then read in
 *   its own context.
 * - gateway_account_tenants(): live studios with a payment connection, for
 *   the admin's review page.
 * - gateway_checkouts_to_reconcile(): (tenant, checkout) of attempts still
 *   open or being created 10 minutes to 2 days after they began and not
 *   checked in the last 10 minutes, for the reconciliation job.
 */
export default class extends BaseSchema {
	async up() {
		const appRole = `"${env.get("DB_USER").replaceAll('"', '""')}"`;
		const statements = [
			`create function public.billing_tenant_for_customer(requested_customer text)
returns uuid
language sql stable strict security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select c.tenant_id
  from public.billing_customers c
  join public.tenants t on t.id = c.tenant_id
  where c.provider_customer_id = requested_customer
    and t.deleted_at is null;
end`,
			`create function public.gateway_tenant_for_webhook(requested_key text)
returns uuid
language sql stable strict security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select a.tenant_id
  from public.gateway_accounts a
  join public.tenants t on t.id = a.tenant_id
  where a.webhook_key = requested_key
    and t.deleted_at is null;
end`,
			`create function public.billing_tenants()
returns table (tenant_id uuid)
language sql stable security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select distinct c.tenant_id
  from public.billing_customers c
  join public.tenants t on t.id = c.tenant_id
  where t.deleted_at is null;
end`,
			`create function public.gateway_account_tenants()
returns table (tenant_id uuid)
language sql stable security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select a.tenant_id
  from public.gateway_accounts a
  join public.tenants t on t.id = a.tenant_id
  where a.disconnected_at is null
    and t.deleted_at is null;
end`,
			`create function public.gateway_checkouts_to_reconcile()
returns table (tenant_id uuid, checkout_id uuid)
language sql stable security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select g.tenant_id, g.id
  from public.gateway_checkouts g
  join public.tenants t on t.id = g.tenant_id
  where g.status in ('creating', 'open')
    and g.created_at between now() - interval '2 days' and now() - interval '10 minutes'
    and (g.last_synced_at is null or g.last_synced_at < now() - interval '10 minutes')
    and t.deleted_at is null
  order by g.created_at
  limit 500;
end`,
		];
		const signatures = [
			"billing_tenant_for_customer(text)",
			"gateway_tenant_for_webhook(text)",
			"billing_tenants()",
			"gateway_account_tenants()",
			"gateway_checkouts_to_reconcile()",
		];
		for (const statement of statements) this.schema.raw(statement);
		for (const signature of signatures) {
			this.schema.raw(`revoke all on function public.${signature} from public`);
			this.schema.raw(
				`grant execute on function public.${signature} to ${appRole}`,
			);
		}
	}

	async down() {
		for (const signature of [
			"gateway_checkouts_to_reconcile()",
			"gateway_account_tenants()",
			"billing_tenants()",
			"gateway_tenant_for_webhook(text)",
			"billing_tenant_for_customer(text)",
		]) {
			this.schema.raw(`drop function public.${signature}`);
		}
	}
}
