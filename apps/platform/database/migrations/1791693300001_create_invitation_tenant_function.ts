import { BaseSchema } from "@adonisjs/lucid/schema";
import env from "#start/env";

/**
 * The invitation page's lookup (TAT-33). Someone opening an invitation link
 * belongs to no studio yet, and the app role sees no studio's rows without
 * one, so InvitationService resolves the token's hash through this
 * SECURITY DEFINER function. It runs as the owner (bypassing RLS) and
 * answers one question: the id of the live tenant holding the invitation
 * whose token_hash is exactly the argument, or null. It never lists
 * invitations; the row itself is read in that tenant's context.
 *
 * Hardened as database/README.md asks, like tenant_for_slug: one text
 * argument compared with = on a unique column, an SQL-standard body (bound
 * when created, no dynamic SQL), STRICT (null in, null out), a pinned
 * search_path, schema-qualified tables, and EXECUTE for the app role only.
 * The argument isn't named `token_hash`: in an SQL function a column of
 * that name would win.
 */
export default class extends BaseSchema {
	async up() {
		const appRole = `"${env.get("DB_USER").replaceAll('"', '""')}"`;
		const statements = [
			`create function public.invitation_tenant(requested_hash text)
returns uuid
language sql stable strict security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select i.tenant_id
  from public.tenant_invitations i
  join public.tenants t on t.id = i.tenant_id
  where i.token_hash = requested_hash
    and t.deleted_at is null;
end`,
			"revoke all on function public.invitation_tenant(text) from public",
			`grant execute on function public.invitation_tenant(text) to ${appRole}`,
		];
		for (const statement of statements) this.schema.raw(statement);
	}

	async down() {
		this.schema.raw("drop function public.invitation_tenant(text)");
	}
}
