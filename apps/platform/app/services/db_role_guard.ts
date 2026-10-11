import type { QueryClientContract } from "@adonisjs/lucid/types/database";

/**
 * Throws unless the connected role is one row-level security applies to:
 * not a superuser, no BYPASSRLS, and not the owner of a table in `public`.
 * Owners bypass RLS, and so does a member that inherits an owner role
 * (pg_has_role … 'USAGE' covers both), so a misconfigured DB_USER would
 * silently turn the second isolation layer off.
 */
export async function assertRestrictedDbRole(client: QueryClientContract) {
	const { rows } = await client.rawQuery(`
		select r.rolname, r.rolsuper, r.rolbypassrls,
			exists (
				select 1
				from pg_class c
				join pg_namespace n on n.oid = c.relnamespace
				where n.nspname = 'public'
					and c.relkind in ('r', 'p')
					and pg_has_role(current_user, c.relowner, 'USAGE')
			) as owns_tables
		from pg_roles r
		where r.rolname = current_user
	`);
	const role = rows[0];

	const problems: string[] = [];
	if (role.rolsuper) problems.push("is a superuser");
	if (role.rolbypassrls) problems.push("has BYPASSRLS");
	if (role.owns_tables) {
		problems.push("owns a table in public, or is a member of a role that does");
	}
	if (problems.length > 0) {
		throw new Error(
			`Database role "${role.rolname}" ${problems.join(" and ")}, so row-level security would not protect tenant data. Set DB_USER to the restricted app role (see database/setup_roles.sql).`,
		);
	}
}
