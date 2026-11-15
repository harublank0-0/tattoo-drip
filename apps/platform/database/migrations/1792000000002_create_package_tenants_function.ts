import { BaseSchema } from "@adonisjs/lucid/schema";
import env from "#start/env";

/**
 * `package_tenants()`: the ids of every live studio, for the admin Billing
 * page's package states (studio packages): pilots, trials and paused studios
 * that never subscribed have no billing customer, so `billing_tenants()`
 * leaves them out, and they are the ones staff must check before enforcement.
 * Ids only, no arguments, pinned search_path, no EXECUTE for PUBLIC; each
 * studio is then read in its own context (database/README.md).
 */
export default class extends BaseSchema {
	async up() {
		const appRole = `"${env.get("DB_USER").replaceAll('"', '""')}"`;
		this.schema.raw(`create function public.package_tenants()
returns table (tenant_id uuid)
language sql stable security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select t.id from public.tenants t where t.deleted_at is null;
end`);
		this.schema.raw(
			"revoke all on function public.package_tenants() from public",
		);
		this.schema.raw(
			`grant execute on function public.package_tenants() to ${appRole}`,
		);
	}

	async down() {
		this.schema.raw("drop function public.package_tenants()");
	}
}
