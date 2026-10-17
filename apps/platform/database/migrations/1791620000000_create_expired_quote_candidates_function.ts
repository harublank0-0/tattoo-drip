import { BaseSchema } from "@adonisjs/lucid/schema";
import env from "#start/env";

/**
 * The expiry sweep's cross-tenant read (TAT-83). The app role can't see
 * other tenants' rows, so SweepExpiredQuotesJob lists expired current
 * quotes through this SECURITY DEFINER function, which runs as the owner
 * (it bypasses RLS) and returns ids only; ProjectService.expireQuote then
 * decides each one in its own tenant. Hardened as database/README.md asks:
 * no arguments, an SQL-standard body (bound when created, no dynamic SQL),
 * a pinned search_path, schema-qualified tables, and EXECUTE for the app
 * role only (Postgres grants it to PUBLIC by default). The index keeps the
 * sweep's scan to its 24-hour window.
 */
export default class extends BaseSchema {
	async up() {
		// The app role (DB_USER, created by setup_roles.sql) as an SQL
		// identifier. A role that doesn't exist fails the migration.
		const appRole = `"${env.get("DB_USER").replaceAll('"', '""')}"`;
		const statements = [
			"create index quotes_expires_at_index on quotes (expires_at)",
			`create function public.expired_quote_candidates()
returns table (tenant_id uuid, project_id uuid, quote_id uuid)
language sql stable security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select q.tenant_id, q.project_id, q.id
  from public.quotes q
  join public.tattoo_projects p on p.tenant_id = q.tenant_id and p.id = q.project_id
  where q.expires_at <= statement_timestamp() - interval '2 minutes'
    and q.expires_at > statement_timestamp() - interval '24 hours'
    and p.deleted_at is null
    and p.status in ('quoted', 'on_hold', 'deposit_pending')
    and not exists (
      select 1 from public.quotes newer
      where newer.tenant_id = q.tenant_id and newer.project_id = q.project_id
        and newer.version > q.version
    )
  order by q.expires_at, q.id;
end`,
			"revoke all on function public.expired_quote_candidates() from public",
			`grant execute on function public.expired_quote_candidates() to ${appRole}`,
		];
		for (const statement of statements) this.schema.raw(statement);
	}

	async down() {
		this.schema.raw("drop function public.expired_quote_candidates()");
		this.schema.raw("drop index quotes_expires_at_index");
	}
}
