import { test } from "@japa/runner";
import { dbClient } from "#services/db_context";

/**
 * Tables without row-level security, and why. A new table that is neither
 * on this list nor RLS-protected fails the guard: adding to the list is a
 * conscious edit. A table with a tenant_id column can never be listed.
 */
const EXEMPT: Record<string, string> = {
	users:
		"global identity, read before any context exists (login, session, signup)",
	queue_jobs: "queue storage, not tenant-owned",
	queue_schedules: "queue storage, not tenant-owned",
	adonis_schema: "migration bookkeeping",
	adonis_schema_versions: "migration bookkeeping",
};

/** The exact policies each protected table has, as "name:COMMAND". */
const EXPECTED_POLICIES: Record<string, string[]> = {
	artists: ["tenant_isolation:ALL"],
	clients: ["tenant_isolation:ALL"],
	inquiries: ["tenant_isolation:ALL"],
	payment_methods: ["tenant_isolation:ALL"],
	tattoo_projects: ["tenant_isolation:ALL"],
	tenant_memberships: [
		"tenant_memberships_delete:DELETE",
		"tenant_memberships_insert:INSERT",
		"tenant_memberships_select:SELECT",
		"tenant_memberships_update:UPDATE",
	],
	tenants: [
		"tenants_insert:INSERT",
		"tenants_select:SELECT",
		"tenants_update:UPDATE",
	],
};

async function rows<T>(query: string) {
	const result = await dbClient().rawQuery(query);
	return result.rows as T[];
}

test.group("Catalog guard", () => {
	test("every table has RLS and a policy, or is on the exemption list", async ({
		assert,
	}) => {
		const tables = await rows<{ table_name: string; rls: boolean }>(
			`select c.relname as table_name, c.relrowsecurity as rls
			 from pg_class c join pg_namespace n on n.oid = c.relnamespace
			 where n.nspname = 'public' and c.relkind = 'r'`,
		);
		const policies = await rows<{ tablename: string }>(
			"select tablename from pg_policies where schemaname = 'public'",
		);
		const withPolicy = new Set(policies.map(({ tablename }) => tablename));

		const unprotected = tables
			.filter(({ table_name, rls }) => !(rls && withPolicy.has(table_name)))
			.map(({ table_name }) => table_name)
			.filter((name) => !(name in EXEMPT));
		assert.deepEqual(
			unprotected,
			[],
			"use enableTenantRls() in the migration, or add a reasoned exemption",
		);

		const stale = Object.keys(EXEMPT).filter(
			(name) => !tables.some(({ table_name }) => table_name === name),
		);
		assert.deepEqual(stale, [], "exemptions for tables that no longer exist");
	});

	test("a table with a tenant_id column is never exempt", async ({
		assert,
	}) => {
		const owned = (
			await rows<{ table_name: string }>(
				"select table_name from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id'",
			)
		).map(({ table_name }) => table_name);

		assert.deepEqual(
			owned.filter((name) => name in EXEMPT),
			[],
		);
	});

	test("each protected table has exactly the expected policies", async ({
		assert,
	}) => {
		const policies = await rows<{
			tablename: string;
			policyname: string;
			cmd: string;
		}>(
			"select tablename, policyname, cmd from pg_policies where schemaname = 'public'",
		);
		const actual: Record<string, string[]> = {};
		for (const { tablename, policyname, cmd } of policies) {
			actual[tablename] = [
				...(actual[tablename] ?? []),
				`${policyname}:${cmd}`,
			];
		}
		for (const names of Object.values(actual)) names.sort();

		assert.deepEqual(actual, EXPECTED_POLICIES);
	});

	test("no policy is a literal true, and every write policy has an explicit check", async ({
		assert,
	}) => {
		const policies = await rows<{
			policyname: string;
			cmd: string;
			qual: string | null;
			with_check: string | null;
		}>(
			"select policyname, cmd, qual, with_check from pg_policies where schemaname = 'public'",
		);

		for (const { policyname, cmd, qual, with_check } of policies) {
			assert.notEqual(qual, "true", `${policyname} USING`);
			assert.notEqual(with_check, "true", `${policyname} WITH CHECK`);
			if (["ALL", "INSERT", "UPDATE"].includes(cmd)) {
				assert.isNotNull(
					with_check,
					`${policyname} needs an explicit WITH CHECK`,
				);
			}
		}
	});

	test("every tenant-owned table has UNIQUE (tenant_id, id)", async ({
		assert,
	}) => {
		const owned = (
			await rows<{ table_name: string }>(
				"select table_name from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id'",
			)
		).map(({ table_name }) => table_name);
		const uniques = await rows<{ table_name: string; def: string }>(
			`select conrelid::regclass::text as table_name, pg_get_constraintdef(oid) as def
			 from pg_constraint where contype = 'u' and connamespace = 'public'::regnamespace`,
		);

		const missing = owned.filter(
			(name) =>
				!uniques.some(
					(unique) =>
						unique.table_name === name &&
						unique.def === "UNIQUE (tenant_id, id)",
				),
		);
		assert.deepEqual(missing, []);
	});

	test("every foreign key between tenant-owned tables includes tenant_id", async ({
		assert,
	}) => {
		const owned = new Set(
			(
				await rows<{ table_name: string }>(
					"select table_name from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id'",
				)
			).map(({ table_name }) => table_name),
		);
		const keys = await rows<{ child: string; parent: string; cols: string[] }>(
			`select con.conrelid::regclass::text as child, con.confrelid::regclass::text as parent,
			        array(select a.attname::text from pg_attribute a
			              where a.attrelid = con.conrelid and a.attnum = any(con.conkey)) as cols
			 from pg_constraint con
			 where con.contype = 'f' and con.connamespace = 'public'::regnamespace`,
		);

		const loose = keys
			.filter(({ child, parent }) => owned.has(child) && owned.has(parent))
			.filter(({ cols }) => !cols.includes("tenant_id"))
			.map(({ child, parent }) => `${child} -> ${parent}`);
		assert.deepEqual(loose, [], "use tenantReference() in the migration");
	});
});
