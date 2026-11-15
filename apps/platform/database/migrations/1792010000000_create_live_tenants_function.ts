import { BaseSchema } from "@adonisjs/lucid/schema";
import env from "#start/env";

/**
 * `live_tenants()`: the ids of every live studio, for the admin's Studios and
 * Metrics pages, each studio then read in its own context (database/README.md).
 * Ids only, no arguments, pinned search_path, no EXECUTE for PUBLIC.
 */
export default class extends BaseSchema {
	async up() {
		const appRole = `"${env.get("DB_USER").replaceAll('"', '""')}"`;
		this.schema.raw(`create function public.live_tenants()
returns table (tenant_id uuid)
language sql stable security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select t.id from public.tenants t where t.deleted_at is null;
end`);
		this.schema.raw("revoke all on function public.live_tenants() from public");
		this.schema.raw(
			`grant execute on function public.live_tenants() to ${appRole}`,
		);
	}

	async down() {
		this.schema.raw("drop function public.live_tenants()");
	}
}
