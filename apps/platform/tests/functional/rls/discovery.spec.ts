import db from "@adonisjs/lucid/services/db";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { test } from "@japa/runner";
import { withDbContext } from "#services/db_context";
import env from "#start/env";

/**
 * Discover's cross-tenant read boundary (Discover D02,
 * docs/discover/database-security.md), proven against PostgreSQL itself.
 *
 * Every test runs in one transaction on the owner connection that is rolled
 * back at the end: the owner writes the fixtures (it bypasses RLS), then
 * `SET LOCAL ROLE` reads as the app role or the discovery role, exactly as
 * their sessions would. A refused statement runs in a savepoint, so the
 * test can go on. Nothing is committed and no role leaks out of the
 * transaction (checked at the end).
 */
const DISCOVERY = "tattoo_drip_discovery";
const APP = env.get("DB_USER");
const VIEWS = ["artists", "artworks", "studios"];

/** The columns the discovery role may read (the migration's COLUMN_GRANTS). */
const READABLE: Record<string, string[]> = {
	artist_work_photos: [
		"alt",
		"artist_id",
		"created_at",
		"discovery_suspended_at",
		"healed",
		"height",
		"hidden",
		"id",
		"image_key",
		"styles",
		"tenant_id",
		"width",
	],
	artists: [
		"accepting_flash",
		"accepting_inquiries",
		"bio",
		"created_at",
		"deleted_at",
		"discovery_listed",
		"facebook_url",
		"id",
		"instagram_url",
		"name",
		"photo_height",
		"photo_key",
		"photo_width",
		"slug",
		"styles",
		"tenant_id",
		"tiktok_url",
		"visible",
	],
	tenant_memberships: ["deleted_at", "tenant_id", "user_id"],
	tenants: [
		"cover_image_height",
		"cover_image_key",
		"cover_image_width",
		"deleted_at",
		"discovery_listed",
		"discovery_listed_at",
		"discovery_suspended_at",
		"facebook_url",
		"id",
		"instagram_url",
		"intro",
		"logo_icon_key",
		"logo_image_height",
		"logo_image_key",
		"logo_image_width",
		"logo_tile",
		"name",
		"place_id",
		"slug",
		"tiktok_url",
		"timezone",
		"type",
		"website_url",
	],
};

type Trx = TransactionClientContract;

/** Runs `fn` in an owner transaction that is always rolled back. */
async function rolledBack(fn: (trx: Trx) => Promise<void>) {
	const trx = await db.connection("owner").transaction();
	try {
		await fn(trx);
	} finally {
		await trx.rollback();
	}
}

async function rows<T = Record<string, unknown>>(
	trx: Trx,
	query: string,
	bindings: unknown[] = [],
): Promise<T[]> {
	return (await trx.rawQuery(query, bindings as never)).rows as T[];
}

/**
 * `query` as `role`, with an optional tenant/user context, inside a
 * savepoint that is always rolled back: SET LOCAL ROLE and set_config(…,
 * true) outlive a released savepoint (they last until the transaction ends),
 * so only the rollback puts the owner back for the next statement.
 */
async function as<T = Record<string, unknown>>(
	trx: Trx,
	role: string,
	query: string,
	context: { tenantId?: string; userId?: string } = {},
): Promise<T[]> {
	await trx.rawQuery("savepoint td_d02_as");
	try {
		await trx.rawQuery(`set local role "${role.replaceAll('"', '""')}"`);
		await trx.rawQuery(
			"select set_config('app.tenant_id', ?, true), set_config('app.user_id', ?, true)",
			[context.tenantId ?? "", context.userId ?? ""],
		);
		return (await trx.rawQuery(query)).rows as T[];
	} finally {
		await trx.rawQuery("rollback to savepoint td_d02_as");
	}
}

/** Asserts that `run` fails with an error matching `error`, naming `label` if not. */
async function refused(
	assert: {
		fail(message: string): never;
		match(value: string, regexp: RegExp, message?: string): void;
	},
	run: () => Promise<unknown>,
	error: RegExp,
	label: string,
) {
	try {
		await run();
	} catch (thrown) {
		assert.match(String((thrown as Error).message), error, label);
		return;
	}
	assert.fail(`${label}: expected an error matching ${error}`);
}

const ids = (list: { id: string }[]) => list.map(({ id }) => id).sort();

/**
 * Two listed businesses (a studio, an independent artist) and four that are
 * not (never listed, opted out, taken down, deleted), each with an artist
 * and a published photo, plus artists and photos that must not show at the
 * listed studio. Returns the ids by name.
 */
async function seed(trx: Trx) {
	const kathmandu = (
		await rows<{ id: string }>(
			trx,
			"select id from places where country_code = 'NP' and slug = 'kathmandu'",
		)
	)[0].id;
	const tenant = async (
		slug: string,
		values: Record<string, unknown>,
	): Promise<string> => {
		const row = {
			type: "studio",
			name: slug,
			slug: `d02-${slug}`,
			contact_phone: "+9779800000000",
			contact_email: `${slug}@example.com`,
			deposit_policy: "private deposit text",
			default_deposit_percent: 30,
			...values,
		};
		const columns = Object.keys(row);
		const result = await rows<{ id: string }>(
			trx,
			`insert into tenants (${columns.join(", ")}, created_at) values (${columns.map(() => "?").join(", ")}, now()) returning id`,
			Object.values(row),
		);
		return result[0].id;
	};
	const listed = { discovery_listed: true, discovery_listed_at: new Date() };
	const t = {
		studio: await tenant("studio", { ...listed, place_id: kathmandu }),
		independent: await tenant("solo", { ...listed, type: "independent" }),
		never: await tenant("never", {}),
		optedOut: await tenant("opted-out", {
			discovery_listed: false,
			discovery_listed_at: new Date(),
		}),
		takenDown: await tenant("taken-down", {
			...listed,
			discovery_suspended_at: new Date(),
			discovery_suspension_note: "internal reason",
		}),
		deleted: await tenant("deleted", { ...listed, deleted_at: new Date() }),
	};

	const user = (
		await rows<{ id: string }>(
			trx,
			"insert into users (email, password, created_at) values ('d02-member@example.com', 'x', now()) returning id",
		)
	)[0].id;
	await trx.rawQuery(
		"insert into tenant_memberships (tenant_id, user_id, role, created_at) values (?, ?, 'owner', now())",
		[t.never, user],
	);

	const artist = async (
		tenantId: string,
		slug: string,
		values: Record<string, unknown> = {},
	) =>
		(
			await rows<{ id: string }>(
				trx,
				`insert into artists (tenant_id, name, slug, styles, created_at${Object.keys(
					values,
				)
					.map((c) => `, ${c}`)
					.join("")})
				 values (?, ?, ?, '{fine-line}', now()${Object.keys(values)
						.map(() => ", ?")
						.join("")}) returning id`,
				[tenantId, slug, slug, ...Object.values(values)],
			)
		)[0].id;
	const a = {
		// Linked to a login, which Discover never shows.
		shown: await artist(t.studio, "shown", { user_id: user }),
		optedOut: await artist(t.studio, "opted-out", {
			discovery_listed: false,
		}),
		hidden: await artist(t.studio, "hidden", { visible: false }),
		deleted: await artist(t.studio, "deleted", { deleted_at: new Date() }),
		solo: await artist(t.independent, "solo"),
		never: await artist(t.never, "never"),
		tenantOptedOut: await artist(t.optedOut, "x"),
		tenantTakenDown: await artist(t.takenDown, "y"),
		tenantDeleted: await artist(t.deleted, "z"),
	};

	const photo = async (
		tenantId: string,
		artistId: string,
		values: Record<string, unknown> = {},
	) =>
		(
			await rows<{ id: string }>(
				trx,
				`insert into artist_work_photos (tenant_id, artist_id, image_key, width, height, styles, created_at${Object.keys(
					values,
				)
					.map((c) => `, ${c}`)
					.join("")})
				 values (?, ?, 'tenants/x/artist_work_photo/k.jpg', 800, 600, '{fine-line}', now()${Object.keys(
						values,
					)
						.map(() => ", ?")
						.join("")}) returning id`,
				[tenantId, artistId, ...Object.values(values)],
			)
		)[0].id;
	const p = {
		shown: await photo(t.studio, a.shown),
		unpublished: await photo(t.studio, a.shown, { hidden: true }),
		takenDown: await photo(t.studio, a.shown, {
			discovery_suspended_at: new Date(),
		}),
		byOptedOutArtist: await photo(t.studio, a.optedOut),
		byHiddenArtist: await photo(t.studio, a.hidden),
		byDeletedArtist: await photo(t.studio, a.deleted),
		solo: await photo(t.independent, a.solo),
		never: await photo(t.never, a.never),
		tenantOptedOut: await photo(t.optedOut, a.tenantOptedOut),
		tenantTakenDown: await photo(t.takenDown, a.tenantTakenDown),
		tenantDeleted: await photo(t.deleted, a.tenantDeleted),
	};
	return { t, a, p, user, kathmandu };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

/** What the app role reads through the views. */
async function discover(
	trx: Trx,
	context: { tenantId?: string; userId?: string } = {},
) {
	return {
		studios: ids(
			await as(trx, APP, "select id from discovery.studios", context),
		),
		artists: ids(
			await as(trx, APP, "select id from discovery.artists", context),
		),
		artworks: ids(
			await as(trx, APP, "select id from discovery.artworks", context),
		),
	};
}

/** Only the seeded rows (the database may hold other committed data). */
function seededOnly(
	view: Awaited<ReturnType<typeof discover>>,
	{ t, a, p }: Seeded,
) {
	const keep = (all: Record<string, string>) => {
		const set = new Set(Object.values(all));
		return (list: string[]) => list.filter((id) => set.has(id));
	};
	return {
		studios: keep(t)(view.studios),
		artists: keep(a)(view.artists),
		artworks: keep(p)(view.artworks),
	};
}

test.group("Discover database: catalog (D02)", () => {
	test("the discovery role cannot log in, is no superuser, never bypasses RLS and is nobody's member", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			const [role] = await rows(
				trx,
				`select rolcanlogin, rolsuper, rolbypassrls, rolinherit, rolcreaterole,
				        rolcreatedb, rolreplication
				 from pg_roles where rolname = ?`,
				[DISCOVERY],
			);
			assert.deepEqual(role, {
				rolcanlogin: false,
				rolsuper: false,
				rolbypassrls: false,
				rolinherit: false,
				rolcreaterole: false,
				rolcreatedb: false,
				rolreplication: false,
			});
			assert.deepEqual(
				await rows(
					trx,
					`select r.rolname as role, m.rolname as member from pg_auth_members am
					 join pg_roles r on r.oid = am.roleid join pg_roles m on m.oid = am.member
					 where r.rolname = ? or m.rolname = ?`,
					[DISCOVERY, DISCOVERY],
				),
				[],
			);
			const [app] = await rows(
				trx,
				`select pg_has_role(?, ?, 'MEMBER') as member, pg_has_role(?, ?, 'USAGE') as usage,
				        pg_has_role(?, ?, 'SET') as can_set,
				        (select rolbypassrls from pg_roles where rolname = ?) as app_bypasses
				 `,
				[APP, DISCOVERY, APP, DISCOVERY, APP, DISCOVERY, APP],
			);
			assert.deepEqual(app, {
				member: false,
				usage: false,
				can_set: false,
				app_bypasses: false,
			});
		});
	});

	test("the discovery role owns exactly the three views, which run as their owner (not security_invoker)", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			const owned = await rows<{
				name: string;
				kind: string;
				options: string[] | null;
			}>(
				trx,
				`select n.nspname || '.' || c.relname as name, c.relkind::text as kind, c.reloptions as options
				 from pg_class c join pg_namespace n on n.oid = c.relnamespace
				 where c.relowner = (select oid from pg_roles where rolname = ?)
				 order by 1`,
				[DISCOVERY],
			);
			assert.deepEqual(
				owned.map(({ name, kind }) => `${name}:${kind}`),
				VIEWS.map((view) => `discovery.${view}:v`),
			);
			// No options at all: not security_invoker (the views read as their
			// owner, whose RLS policies are the point), and no barrier, which RLS
			// makes redundant (the migration says why).
			for (const { name, options } of owned) {
				assert.isNull(options, name);
			}

			// Nothing else in the schema, nothing else owned by the role anywhere.
			assert.deepEqual(
				(
					await rows<{ relname: string }>(
						trx,
						"select relname from pg_class where relnamespace = 'discovery'::regnamespace order by 1",
					)
				).map(({ relname }) => relname),
				VIEWS,
			);
			assert.deepEqual(
				await rows(
					trx,
					`select p.proname from pg_proc p where p.proowner = (select oid from pg_roles where rolname = ?)
					 union all select nspname from pg_namespace where nspowner = (select oid from pg_roles where rolname = ?)
					 union all select proname from pg_proc where pronamespace = 'discovery'::regnamespace`,
					[DISCOVERY, DISCOVERY],
				),
				[],
			);
			const [schema] = await rows(
				trx,
				`select has_schema_privilege(?, 'discovery', 'CREATE') as role_creates,
				        has_schema_privilege(?, 'discovery', 'CREATE') as app_creates,
				        has_schema_privilege(?, 'discovery', 'USAGE') as app_uses,
				        has_schema_privilege('public', 'discovery', 'USAGE') as public_uses`,
				[DISCOVERY, APP, APP],
			);
			assert.deepEqual(schema, {
				role_creates: false,
				app_creates: false,
				app_uses: true,
				public_uses: false,
			});
		});
	});

	test("the tables the views read are not the role's, keep RLS on and are not forced", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			const tables = await rows(
				trx,
				`select c.relname as table, pg_get_userbyid(c.relowner) <> ? as other_owner,
				        c.relrowsecurity as rls
				 from pg_class c where c.oid in ('public.tenants'::regclass, 'public.artists'::regclass,
				   'public.artist_work_photos'::regclass, 'public.tenant_memberships'::regclass)
				 order by 1`,
				[DISCOVERY],
			);
			for (const row of tables) {
				assert.deepInclude(row, { other_owner: true, rls: true });
			}
			assert.lengthOf(tables, 4);
		});
	});

	test("the discovery policies apply to the discovery role only, and every other policy is unchanged", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			const policies = await rows<{
				table: string;
				name: string;
				permissive: string;
				roles: string[];
				cmd: string;
			}>(
				trx,
				`select tablename as table, policyname as name, permissive, roles::text[] as roles, cmd
				 from pg_policies where schemaname = 'public' order by 1, 2`,
			);
			const discovery = policies.filter(({ name }) =>
				name.startsWith("discovery_"),
			);
			assert.deepEqual(
				discovery.map(
					({ table, name, permissive, roles, cmd }) =>
						`${table}.${name}:${permissive}:${roles.join(",")}:${cmd}`,
				),
				[
					`artist_work_photos.discovery_only:RESTRICTIVE:${DISCOVERY}:SELECT`,
					`artist_work_photos.discovery_select:PERMISSIVE:${DISCOVERY}:SELECT`,
					`artists.discovery_only:RESTRICTIVE:${DISCOVERY}:SELECT`,
					`artists.discovery_select:PERMISSIVE:${DISCOVERY}:SELECT`,
					`tenant_memberships.discovery_none:RESTRICTIVE:${DISCOVERY}:SELECT`,
					`tenants.discovery_only:RESTRICTIVE:${DISCOVERY}:SELECT`,
					`tenants.discovery_select:PERMISSIVE:${DISCOVERY}:SELECT`,
				],
			);
			// The tenant policies still apply to every role, as before; none is
			// restrictive or names a role (the app role gets nothing new).
			for (const policy of policies.filter(
				({ name }) => !name.startsWith("discovery_"),
			)) {
				assert.deepEqual(
					[policy.permissive, policy.roles],
					["PERMISSIVE", ["public"]],
					`${policy.table}.${policy.name}`,
				);
			}
		});
	});

	test("the discovery role may read exactly the public columns, and write nothing", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			const columns = await rows<{
				table: string;
				column: string;
				can_select: boolean;
				can_write: boolean;
			}>(
				trx,
				`select c.relname as table, a.attname as column,
				        has_column_privilege(?, c.oid, a.attnum, 'SELECT') as can_select,
				        has_column_privilege(?, c.oid, a.attnum, 'INSERT')
				          or has_column_privilege(?, c.oid, a.attnum, 'UPDATE')
				          or has_column_privilege(?, c.oid, a.attnum, 'REFERENCES') as can_write
				 from pg_class c
				 join pg_namespace n on n.oid = c.relnamespace
				 join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
				 where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
				 order by 1, 2`,
				[DISCOVERY, DISCOVERY, DISCOVERY, DISCOVERY],
			);
			const readable: Record<string, string[]> = {};
			for (const { table, column, can_select } of columns) {
				if (can_select) readable[table] = [...(readable[table] ?? []), column];
			}
			assert.deepEqual(readable, READABLE);
			assert.deepEqual(
				columns.filter(({ can_write }) => can_write),
				[],
			);

			const tables = await rows(
				trx,
				`select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
				 where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'S')
				   and (has_table_privilege(?, c.oid, 'SELECT') or has_table_privilege(?, c.oid, 'INSERT')
				     or has_table_privilege(?, c.oid, 'UPDATE') or has_table_privilege(?, c.oid, 'DELETE')
				     or has_table_privilege(?, c.oid, 'TRUNCATE') or has_table_privilege(?, c.oid, 'TRIGGER')
				     or has_table_privilege(?, c.oid, 'MAINTAIN'))`,
				Array(7).fill(DISCOVERY),
			);
			assert.deepEqual(tables, [], "no table-wide privilege at all");
		});
	});

	test("the app role may only read the views and the places", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			for (const view of VIEWS) {
				const [privileges] = await rows(
					trx,
					`select has_table_privilege(?, ?, 'SELECT') as can_select,
					        has_table_privilege(?, ?, 'INSERT') or has_table_privilege(?, ?, 'UPDATE')
					          or has_table_privilege(?, ?, 'DELETE') or has_table_privilege(?, ?, 'TRUNCATE')
					          or has_table_privilege(?, ?, 'REFERENCES') or has_table_privilege(?, ?, 'TRIGGER')
					          or has_table_privilege(?, ?, 'MAINTAIN') as can_change,
					        has_table_privilege('public', ?, 'SELECT') as public_selects`,
					[
						...Array(8)
							.fill(null)
							.flatMap(() => [APP, `discovery.${view}`]),
						`discovery.${view}`,
					],
				);
				assert.deepEqual(
					privileges,
					{ can_select: true, can_change: false, public_selects: false },
					view,
				);
			}
			const [places] = await rows(
				trx,
				`select has_table_privilege(?, 'public.places', 'SELECT') as can_select,
				        has_table_privilege(?, 'public.places', 'INSERT') or has_table_privilege(?, 'public.places', 'UPDATE')
				          or has_table_privilege(?, 'public.places', 'DELETE')
				          or has_table_privilege(?, 'public.places', 'TRUNCATE') as can_change`,
				[APP, APP, APP, APP, APP],
			);
			assert.deepEqual(places, { can_select: true, can_change: false });
		});
	});
});

test.group("Discover database: who can read what (D02)", () => {
	test("the views show only listed businesses, shown artists and published photos, with no tenant context", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			const seeded = await seed(trx);
			const { t, a, p } = seeded;

			assert.deepEqual(seededOnly(await discover(trx), seeded), {
				studios: [t.studio, t.independent].sort(),
				artists: [a.shown, a.solo].sort(),
				artworks: [p.shown, p.solo].sort(),
			});
		});
	});

	test("a tenant or user context, forged or real, changes nothing the views show", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			const seeded = await seed(trx);
			const { t, user } = seeded;
			const expected = seededOnly(await discover(trx), seeded);

			for (const context of [
				{ tenantId: t.never },
				{ tenantId: t.takenDown },
				{ tenantId: t.studio },
				{ userId: user },
				{ tenantId: t.never, userId: user },
			]) {
				assert.deepEqual(
					seededOnly(await discover(trx, context), seeded),
					expected,
					JSON.stringify(context),
				);
			}
		});
	});

	test("an independent artist is listed like a studio, as type independent", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			const { t } = await seed(trx);
			const [row] = await as<{ type: string; place_id: string | null }>(
				trx,
				APP,
				`select type, place_id from discovery.studios where id = '${t.independent}'`,
			);
			assert.deepEqual(row, { type: "independent", place_id: null });
		});
	});

	test("the views have no private column, and none can be asked for", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			const columns = await rows<{ table_name: string; column_name: string }>(
				trx,
				`select table_name, column_name from information_schema.columns
				 where table_schema = 'discovery' order by table_name, ordinal_position`,
			);
			const byView: Record<string, string[]> = {};
			for (const { table_name, column_name } of columns) {
				byView[table_name] = [...(byView[table_name] ?? []), column_name];
			}
			assert.deepEqual(byView, {
				artists: [
					"id",
					"studio_id",
					"slug",
					"name",
					"bio",
					"photo_key",
					"photo_width",
					"photo_height",
					"styles",
					"accepting_inquiries",
					"accepting_flash",
					"instagram_url",
					"facebook_url",
					"tiktok_url",
					"created_at",
				],
				artworks: [
					"id",
					"studio_id",
					"artist_id",
					"image_key",
					"width",
					"height",
					"alt",
					"styles",
					"healed",
					"created_at",
				],
				studios: [
					"id",
					"slug",
					"type",
					"name",
					"intro",
					"timezone",
					"place_id",
					"cover_image_key",
					"cover_image_width",
					"cover_image_height",
					"logo_image_key",
					"logo_image_width",
					"logo_image_height",
					"logo_tile",
					"logo_icon_key",
					"instagram_url",
					"facebook_url",
					"tiktok_url",
					"website_url",
					"listed_at",
				],
			});

			for (const query of [
				"select contact_phone from discovery.studios",
				"select discovery_suspension_note from discovery.studios",
				"select deposit_policy from discovery.studios",
				"select user_id from discovery.artists",
				"select hidden from discovery.artworks",
			]) {
				await refused(
					assert,
					() => as(trx, APP, query),
					/does not exist/,
					query,
				);
			}
		});
	});

	test("the discovery role reads only eligible rows and public columns of the tables, whatever the context", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			const seeded = await seed(trx);
			const { t, a, p, user } = seeded;
			const keep = (all: Record<string, string>, list: { id: string }[]) =>
				ids(list).filter((id) => Object.values(all).includes(id));

			for (const context of [{}, { tenantId: t.never, userId: user }]) {
				assert.deepEqual(
					keep(t, await as(trx, DISCOVERY, "select id from tenants", context)),
					[t.studio, t.independent].sort(),
				);
				assert.deepEqual(
					keep(a, await as(trx, DISCOVERY, "select id from artists", context)),
					[a.shown, a.solo].sort(),
				);
				assert.deepEqual(
					keep(
						p,
						await as(
							trx,
							DISCOVERY,
							"select id from artist_work_photos",
							context,
						),
					),
					[p.shown, p.solo].sort(),
				);
				assert.deepEqual(
					await as(
						trx,
						DISCOVERY,
						"select tenant_id from tenant_memberships",
						context,
					),
					[],
				);
			}

			for (const query of [
				"select contact_phone from tenants",
				"select contact_email from tenants",
				"select deposit_policy from tenants",
				"select default_deposit_percent from tenants",
				"select discovery_suspension_note from tenants",
				"select * from tenants",
				"select user_id from artists",
				"select closed_message from artists",
				"select role from tenant_memberships",
				"select id from users",
				"select id from clients",
				"select id from inquiries",
				"select id from payments",
				"select id from payment_methods",
				"select id from reference_images",
				"select id from places",
			]) {
				await refused(
					assert,
					() => as(trx, DISCOVERY, query),
					/permission denied/,
					query,
				);
			}
		});
	});

	test("the discovery role can change nothing", async ({ assert }) => {
		await rolledBack(async (trx) => {
			const { t, a, p } = await seed(trx);
			for (const query of [
				`update tenants set discovery_listed = true where id = '${t.never}'`,
				`update artists set discovery_listed = true where id = '${a.optedOut}'`,
				`update artist_work_photos set hidden = false where id = '${p.unpublished}'`,
				`delete from artist_work_photos where id = '${p.shown}'`,
				"insert into places (country_code, slug, name) values ('NP', 'x', 'X')",
				"truncate tenant_memberships",
				"create table discovery.leak (id int)",
				"create view discovery.leak as select id from tenants",
				"create or replace view discovery.studios as select id from tenants",
			]) {
				await refused(
					assert,
					() => as(trx, DISCOVERY, query),
					/permission denied/,
					query,
				);
			}
		});
	});

	test("the app role still sees only its own tenant in the tables, and never the role or the views' definitions", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			const { t, a } = await seed(trx);

			// No context: no tenant rows, though Discover now reads them.
			for (const table of ["tenants", "artists", "artist_work_photos"]) {
				assert.deepEqual(
					await as(trx, APP, `select id from ${table}`),
					[],
					table,
				);
			}
			// A tenant context: that tenant's rows, the private ones included, and
			// none of a listed studio's.
			const own = ids(
				await as(trx, APP, "select id from artists", { tenantId: t.never }),
			);
			assert.deepEqual(own, [a.never]);
			assert.notInclude(
				ids(
					await as(trx, APP, "select id from tenants", {
						tenantId: t.never,
					}),
				),
				t.studio,
			);

			for (const query of [
				"alter view discovery.studios owner to current_user",
				"create or replace view discovery.studios as select id from tenants",
				"create table discovery.leak (id int)",
				`insert into discovery.artworks (id) values ('${a.shown}')`,
				"delete from discovery.studios",
			]) {
				await refused(
					assert,
					() => as(trx, APP, query),
					/permission denied|must be owner|not allowed|cannot/,
					query,
				);
			}
		});
	});

	test("a session of the app role cannot become the discovery role or any other", async ({
		assert,
	}) => {
		// The app's own connection (its session user is the app role): SET ROLE
		// and SET SESSION AUTHORIZATION are checked against the session user, so
		// only a real app session proves this.
		const trx = await db.connection().transaction();
		try {
			const [who] = (
				await trx.rawQuery(
					"select current_user as role, session_user as session",
				)
			).rows;
			assert.deepEqual(who, { role: APP, session: APP });
			for (const query of [
				`set role ${DISCOVERY}`,
				`set local role ${DISCOVERY}`,
				`set session authorization ${DISCOVERY}`,
				`set role ${env.get("DB_MIGRATION_USER")}`,
				`grant ${DISCOVERY} to current_user`,
				`alter role ${DISCOVERY} login`,
			]) {
				await refused(
					assert,
					() => trx.transaction((sp) => sp.rawQuery(query)),
					/permission denied|must have|not allowed|only roles with/i,
					query,
				);
			}
			// Not the owner and no grant option: Postgres only warns, and grants
			// nothing.
			await trx.rawQuery("grant select on discovery.studios to public");
			const [granted] = (
				await trx.rawQuery(
					"select has_table_privilege('public', 'discovery.studios', 'SELECT') as public_selects",
				)
			).rows;
			assert.deepEqual(granted, { public_selects: false });
		} finally {
			await trx.rollback();
		}
	});

	test("a role that was granted nothing cannot read the views", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			// Roles are transactional: this one disappears with the rollback.
			await trx.rawQuery("create role td_probe_d02_stranger nologin");
			for (const view of VIEWS) {
				await refused(
					assert,
					() =>
						as(trx, "td_probe_d02_stranger", `select 1 from discovery.${view}`),
					/permission denied for schema discovery/,
					view,
				);
			}
		});
	});
});

test.group("Discover database: publication changes (D02)", () => {
	/** Applies `change` as the owner, then returns what the views show. */
	async function after(
		trx: Trx,
		seeded: Seeded,
		change: string,
		bindings: unknown[] = [],
	) {
		await trx.rawQuery(change, bindings as never);
		return seededOnly(await discover(trx), seeded);
	}

	test("a studio that stops listing, is taken down or is deleted takes its artists and photos with it", async ({
		assert,
	}) => {
		for (const change of [
			"update tenants set discovery_listed = false where id = ?",
			"update tenants set discovery_suspended_at = now() where id = ?",
			"update tenants set deleted_at = now() where id = ?",
		]) {
			await rolledBack(async (trx) => {
				const seeded = await seed(trx);
				const { t, a, p } = seeded;
				assert.deepEqual(
					await after(trx, seeded, change, [t.studio]),
					{
						studios: [t.independent],
						artists: [a.solo],
						artworks: [p.solo],
					},
					change,
				);
			});
		}
	});

	test("an artist who opts out, is hidden or is deleted disappears with their photos; the studio stays", async ({
		assert,
	}) => {
		for (const change of [
			"update artists set discovery_listed = false where id = ?",
			"update artists set visible = false where id = ?",
			"update artists set deleted_at = now() where id = ?",
		]) {
			await rolledBack(async (trx) => {
				const seeded = await seed(trx);
				const { t, a, p } = seeded;
				assert.deepEqual(
					await after(trx, seeded, change, [a.shown]),
					{
						studios: [t.studio, t.independent].sort(),
						artists: [a.solo],
						artworks: [p.solo],
					},
					change,
				);
			});
		}
	});

	test("a photo that is unpublished, taken down or removed disappears alone", async ({
		assert,
	}) => {
		for (const change of [
			"update artist_work_photos set hidden = true where id = ?",
			"update artist_work_photos set discovery_suspended_at = now() where id = ?",
			"delete from artist_work_photos where id = ?",
		]) {
			await rolledBack(async (trx) => {
				const seeded = await seed(trx);
				const { t, a, p } = seeded;
				assert.deepEqual(
					await after(trx, seeded, change, [p.shown]),
					{
						studios: [t.studio, t.independent].sort(),
						artists: [a.shown, a.solo].sort(),
						artworks: [p.solo],
					},
					change,
				);
			});
		}
	});

	test("listing again, or lifting a takedown, brings the rows back at once", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			const seeded = await seed(trx);
			const { t, a, p } = seeded;
			await trx.rawQuery(
				"update tenants set discovery_listed = true where id = ?",
				[t.optedOut],
			);
			await trx.rawQuery(
				"update tenants set discovery_suspended_at = null, discovery_suspension_note = null where id = ?",
				[t.takenDown],
			);
			await trx.rawQuery(
				"update artist_work_photos set discovery_suspended_at = null where id = ?",
				[p.takenDown],
			);
			const shown = seededOnly(await discover(trx), seeded);
			assert.includeMembers(shown.studios, [t.optedOut, t.takenDown]);
			assert.includeMembers(shown.artists, [
				a.tenantOptedOut,
				a.tenantTakenDown,
			]);
			assert.includeMembers(shown.artworks, [
				p.takenDown,
				p.tenantOptedOut,
				p.tenantTakenDown,
			]);
		});
	});

	test("each view lists a row once", async ({ assert }) => {
		await rolledBack(async (trx) => {
			await seed(trx);
			for (const view of VIEWS) {
				const [counts] = await as<{ total: number; distinct: number }>(
					trx,
					APP,
					`select count(*)::int as total, count(distinct id)::int as distinct from discovery.${view}`,
				);
				assert.equal(counts.total, counts.distinct, view);
			}
		});
	});
});

test.group("Discover database: data rules (D02)", () => {
	test("new tenants are off Discover and new artists follow their studio", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			const [tenant] = await rows(
				trx,
				"insert into tenants (type, name, slug, created_at) values ('studio', 'New', 'd02-new', now()) returning discovery_listed, discovery_listed_at, discovery_suspended_at, place_id",
			);
			assert.deepEqual(tenant, {
				discovery_listed: false,
				discovery_listed_at: null,
				discovery_suspended_at: null,
				place_id: null,
			});
			const [artist] = await rows(
				trx,
				"insert into artists (tenant_id, name, slug, created_at) values ((select id from tenants where slug = 'd02-new'), 'A', 'a', now()) returning discovery_listed",
			);
			assert.deepEqual(artist, { discovery_listed: true });
		});
	});

	test("a listing needs its consent time, a takedown note needs a takedown, and a place must exist and stays", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			const { t, kathmandu } = await seed(trx);
			for (const [query, error] of [
				[
					`update tenants set discovery_listed = true, discovery_listed_at = null where id = '${t.never}'`,
					/tenants_discovery_listed_at/,
				],
				[
					`update tenants set discovery_suspension_note = 'x' where id = '${t.never}'`,
					/tenants_discovery_suspension_note/,
				],
				[
					`update tenants set place_id = '00000000-0000-7000-8000-000000000000' where id = '${t.never}'`,
					/foreign key/,
				],
				[`delete from places where id = '${kathmandu}'`, /foreign key/],
				[
					"insert into places (country_code, slug, name) values ('NP', 'kathmandu', 'Kathmandu again')",
					/places_country_slug_unique/,
				],
				[
					"insert into places (country_code, slug, name) values ('np', 'x', 'X')",
					/places_country_code_format/,
				],
				[
					"insert into places (country_code, slug, name) values ('NP', 'Bad Slug', 'X')",
					/places_slug_format/,
				],
			] as const) {
				await refused(
					assert,
					() => trx.transaction((sp) => sp.rawQuery(query)),
					error,
					query,
				);
			}
		});
	});

	test("the curated Nepal cities are there, one per slug", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			const slugs = (
				await as<{ slug: string }>(
					trx,
					APP,
					"select slug from places where country_code = 'NP' order by slug",
				)
			).map(({ slug }) => slug);
			assert.includeMembers(slugs, [
				"bhaktapur",
				"bharatpur",
				"biratnagar",
				"birgunj",
				"butwal",
				"dhangadhi",
				"dharan",
				"hetauda",
				"itahari",
				"janakpur",
				"kathmandu",
				"lalitpur",
				"nepalgunj",
				"pokhara",
			]);
		});
	});
});

test.group("Discover database: no leak between requests (D02)", () => {
	test("reading the views in a request leaves no role or context on the pooled connection", async ({
		assert,
	}) => {
		// The app's own path: a request transaction with a tenant context.
		await withDbContext(
			{ tenantId: "00000000-0000-7000-8000-000000000001" },
			(trx) => trx.rawQuery("select count(*) from discovery.studios"),
		);
		const [after] = (
			await withDbContext({}, (trx) =>
				trx.rawQuery(
					"select current_user as role, session_user as session, coalesce(current_setting('app.tenant_id', true), '') as tenant",
				),
			)
		).rows;
		assert.deepEqual(after, { role: APP, session: APP, tenant: "" });
	});

	test("the owner transactions these tests use end as the owner, with nothing set", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			await as(trx, DISCOVERY, "select 1");
			await as(trx, APP, "select 1", {
				tenantId: "00000000-0000-7000-8000-000000000001",
			});
			const [state] = await rows(
				trx,
				"select current_user = session_user as same, coalesce(current_setting('app.tenant_id', true), '') as tenant",
			);
			assert.deepEqual(state, { same: true, tenant: "" });
		});
	});
});
