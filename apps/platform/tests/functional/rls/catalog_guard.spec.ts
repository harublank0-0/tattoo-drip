import db from "@adonisjs/lucid/services/db";
import type { QueryClientContract } from "@adonisjs/lucid/types/database";
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
	rate_limits:
		"rate-limit counters keyed by HMAC digests (TAT-8), not tenant-owned",
	account_tokens:
		"single-use account links (TAT-18): SHA-256 digests only, read before any context exists by a link anyone may open, not tenant-owned",
	places:
		"platform reference data (Discover D02): the cities a studio can name, the same for everyone; the app role may only read it",
	billing_plans:
		"platform reference data: TattooDrip's own plan catalogue, mirrored to PayBridgeNP (docs/payments-paybridgenp.md); no studio's data",
	adonis_schema: "migration bookkeeping",
	adonis_schema_versions: "migration bookkeeping",
};

/**
 * The exact policies each protected table has, as "name:COMMAND". The
 * discovery_* ones apply to the discovery role only (Discover D02,
 * tests/functional/rls/discovery.spec.ts checks their roles).
 */
const EXPECTED_POLICIES: Record<string, string[]> = {
	artist_work_photos: [
		"discovery_only:SELECT",
		"discovery_select:SELECT",
		"tenant_isolation:ALL",
	],
	artists: [
		"discovery_only:SELECT",
		"discovery_select:SELECT",
		"tenant_isolation:ALL",
	],
	billing_access_periods: ["tenant_isolation:ALL"],
	billing_customers: ["tenant_isolation:ALL"],
	billing_events: ["tenant_isolation:ALL"],
	billing_invoices: ["tenant_isolation:ALL"],
	billing_subscriptions: ["tenant_isolation:ALL"],
	clients: ["tenant_isolation:ALL"],
	deposit_links: ["tenant_isolation:ALL"],
	// Reviews and Fresh ink (slice 1).
	review_links: ["tenant_isolation:ALL"],
	client_reviews: ["tenant_isolation:ALL"],
	client_posts: ["tenant_isolation:ALL"],
	client_post_media: ["tenant_isolation:ALL"],
	client_video_reservations: ["tenant_isolation:ALL"],
	deposit_outcomes: ["tenant_isolation:ALL"],
	flash_designs: ["tenant_isolation:ALL"],
	gateway_accounts: ["tenant_isolation:ALL"],
	gateway_checkouts: ["tenant_isolation:ALL"],
	gateway_events: ["tenant_isolation:ALL"],
	gateway_payments: ["tenant_isolation:ALL"],
	gateway_refunds: ["tenant_isolation:ALL"],
	inquiries: ["tenant_isolation:ALL"],
	inventory_items: ["tenant_isolation:ALL"],
	inventory_lots: ["tenant_isolation:ALL"],
	inventory_movements: ["tenant_isolation:ALL"],
	message_templates: ["tenant_isolation:ALL"],
	payment_methods: ["tenant_isolation:ALL"],
	payments: ["tenant_isolation:ALL"],
	project_sessions: ["tenant_isolation:ALL"],
	quotes: ["tenant_isolation:ALL"],
	reference_codes: ["tenant_isolation:ALL"],
	studio_faq_entries: ["tenant_isolation:ALL"],
	studio_policy_sections: ["tenant_isolation:ALL"],
	reference_images: ["tenant_isolation:ALL"],
	staff_alerts: ["tenant_isolation:ALL"],
	studio_closures: ["tenant_isolation:ALL"],
	studio_hours: ["tenant_isolation:ALL"],
	tattoo_projects: ["tenant_isolation:ALL"],
	tenant_invitations: ["tenant_isolation:ALL"],
	tenant_memberships: [
		"discovery_none:SELECT",
		"tenant_memberships_delete:DELETE",
		"tenant_memberships_insert:INSERT",
		"tenant_memberships_select:SELECT",
		"tenant_memberships_update:UPDATE",
	],
	tenant_slugs: ["tenant_slugs_insert:INSERT", "tenant_slugs_select:SELECT"],
	tenants: [
		"discovery_only:SELECT",
		"discovery_select:SELECT",
		"tenants_insert:INSERT",
		"tenants_select:SELECT",
		"tenants_update:UPDATE",
	],
};

/**
 * SECURITY DEFINER functions, with their argument lists, and why. They run
 * as their owner, which bypasses row-level security, so each one is a
 * conscious edit: ids only, no arguments except one exact lookup key, a
 * pinned search_path and no EXECUTE for PUBLIC (database/README.md).
 */
const DEFINER_FUNCTIONS: Record<string, { args: string; reason: string }> = {
	"public.billing_tenant_for_customer": {
		args: "requested_customer text",
		reason:
			"the id of the live studio whose PayBridgeNP billing customer id is exactly the argument, for signed platform webhooks (docs/payments-paybridgenp.md)",
	},
	"public.billing_tenants": {
		args: "",
		reason:
			"the ids of live studios with a billing customer, for the reconciliation job and the admin Billing page, each read in its own context",
	},
	"public.gateway_account_tenants": {
		args: "",
		reason:
			"the ids of live studios with a payment connection, for the admin review page, each read in its own context",
	},
	"public.gateway_checkouts_to_reconcile": {
		args: "",
		reason:
			"lists (tenant_id, checkout_id) of online checkouts still open 10 minutes to 2 days on, for the reconciliation job",
	},
	"public.gateway_tenant_for_webhook": {
		args: "requested_key text",
		reason:
			"the id of the live studio whose payment connection has exactly this webhook path key, before its own secret checks the signature",
	},
	"public.client_post_tenant": {
		args: "requested_id uuid",
		reason:
			"the id of the live tenant holding the Fresh ink post whose id is exactly the argument, for the operator's takedown commands (Reviews and Fresh ink, slice 2)",
	},
	"public.client_review_tenant": {
		args: "requested_id uuid",
		reason:
			"the id of the live tenant holding the review whose id is exactly the argument, for the operator's takedown commands (Reviews and Fresh ink, slice 2)",
	},
	"public.expired_quote_candidates": {
		args: "",
		reason:
			"lists (tenant_id, project_id, quote_id) of expired current quotes for the expiry sweep (TAT-83)",
	},
	"public.invitation_tenant": {
		args: "requested_hash text",
		reason:
			"the id of the live tenant holding the invitation whose token hash is exactly the argument, for the invitation page (TAT-33)",
	},
	"public.open_review_reports": {
		args: "",
		reason:
			"lists (tenant_id, review_id) of live reviews reported by their studio and not decided, for the operator's report list (Reviews and Fresh ink, slice 2)",
	},
	"public.stale_submitter_tenants": {
		args: "",
		reason:
			"lists the tenant ids holding a review or post submitter digest older than 90 days, for the disputes record's sweep (Reviews and Fresh ink)",
	},
	"public.stuck_client_video_candidates": {
		args: "",
		reason:
			"lists (tenant_id, media_id) of client videos still processing an hour after they were added, for the stuck-video sweep (Reviews and Fresh ink)",
	},
	"public.stuck_video_candidates": {
		args: "",
		reason:
			"lists (tenant_id, photo_id) of videos still processing an hour after they were added, for the stuck-video sweep (video angles)",
	},
	"public.tenant_for_slug": {
		args: "requested_slug text",
		reason:
			"the id of the live tenant whose current or old slug is exactly the argument, for the public API (TAT-32)",
	},
};

async function rows<T>(query: string) {
	const result = await dbClient().rawQuery(query);
	return result.rows as T[];
}

/**
 * The SECURITY DEFINER functions the app owns, in any schema but the
 * system's, as "schema.name" with the settings the guard checks. A function
 * an extension owns is not the app's.
 */
async function definerFunctions(client: QueryClientContract = dbClient()) {
	const result = await client.rawQuery(
		`select n.nspname || '.' || p.proname as name, p.proconfig,
		        pg_get_function_identity_arguments(p.oid) as args,
		        has_function_privilege('public', p.oid, 'execute') as public_can_run
		 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
		 where p.prosecdef
		   and n.nspname not in ('pg_catalog', 'information_schema')
		   and n.nspname !~ '^pg_(toast|temp)'
		   and not exists (
		     select 1 from pg_depend d
		     where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
		   )
		 order by n.nspname collate "C", p.proname collate "C"`,
	);
	return result.rows as {
		name: string;
		args: string;
		proconfig: string[] | null;
		public_can_run: boolean;
	}[];
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

	test("every SECURITY DEFINER function is listed with its arguments, pins search_path and is closed to PUBLIC", async ({
		assert,
	}) => {
		assert.deepEqual(
			await definerFunctions(),
			Object.keys(DEFINER_FUNCTIONS)
				.sort()
				.map((name) => ({
					name,
					args: DEFINER_FUNCTIONS[name].args,
					proconfig: ["search_path=pg_catalog, pg_temp"],
					public_can_run: false,
				})),
		);
	});

	test("the definer guard also sees a function outside public", async ({
		assert,
	}) => {
		// DDL is transactional: the schema and function exist only until the
		// rollback, and only on this connection.
		const probe = await db.connection("owner").transaction();
		let names: string[];
		try {
			await probe.rawQuery("create schema td_probe_definer");
			await probe.rawQuery(
				"create function td_probe_definer.leak() returns int language sql security definer as 'select 1'",
			);
			names = (await definerFunctions(probe)).map(({ name }) => name);
		} finally {
			await probe.rollback();
		}

		assert.include(names, "td_probe_definer.leak");
		assert.include(names, "public.expired_quote_candidates");
		assert.deepEqual(
			await rows(
				"select 1 from pg_namespace where nspname = 'td_probe_definer'",
			),
			[],
		);
	});
});
