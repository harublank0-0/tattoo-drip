import { BaseSchema } from "@adonisjs/lucid/schema";
import env from "#start/env";

/**
 * The public API's tenant lookup (TAT-32). An unauthenticated request has
 * no tenant yet, and the app role sees no tenant without one, so the
 * publicTenant middleware resolves the path's slug through this SECURITY
 * DEFINER function. It runs as the owner (bypassing RLS) and answers one
 * question: the id of the live tenant whose current or old slug
 * (tenant_slugs, TAT-24) is exactly the argument, or null. It never lists
 * tenants.
 *
 * Hardened as database/README.md asks: one text argument compared with =
 * on a unique column, an SQL-standard body (bound when created, no dynamic
 * SQL), STRICT (null in, null out), a pinned search_path, schema-qualified
 * tables, and EXECUTE for the app role only (Postgres grants it to PUBLIC
 * by default). The argument isn't named `slug`: in an SQL function a column
 * of that name would win.
 */
export default class extends BaseSchema {
	async up() {
		// The app role (DB_USER, created by setup_roles.sql) as an SQL
		// identifier. A role that doesn't exist fails the migration.
		const appRole = `"${env.get("DB_USER").replaceAll('"', '""')}"`;
		const statements = [
			`create function public.tenant_for_slug(requested_slug text)
returns uuid
language sql stable strict security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select s.tenant_id
  from public.tenant_slugs s
  join public.tenants t on t.id = s.tenant_id
  where s.slug = requested_slug
    and t.deleted_at is null;
end`,
			"revoke all on function public.tenant_for_slug(text) from public",
			`grant execute on function public.tenant_for_slug(text) to ${appRole}`,
		];
		for (const statement of statements) this.schema.raw(statement);
	}

	async down() {
		this.schema.raw("drop function public.tenant_for_slug(text)");
	}
}
