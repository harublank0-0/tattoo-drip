import { execFile } from "node:child_process";
import { promisify } from "node:util";
import app from "@adonisjs/core/services/app";
import db from "@adonisjs/lucid/services/db";
import { test } from "@japa/runner";
import env from "#start/env";

const run = promisify(execFile);
const ROLE = "td_probe_app";
const owner = () => db.connection("owner");

function setupRoles(appUser: string, ownerUser = env.get("DB_MIGRATION_USER")) {
	return run(
		"psql",
		[
			"-X",
			"-v",
			"ON_ERROR_STOP=1",
			"-h",
			env.get("DB_HOST"),
			"-p",
			String(env.get("DB_PORT")),
			"-U",
			env.get("DB_MIGRATION_USER"),
			"-d",
			env.get("DB_DATABASE"),
			"-v",
			`app_user=${appUser}`,
			"-v",
			"app_password=probe-password",
			"-v",
			`owner_user=${ownerUser}`,
			"-f",
			app.makePath("database/setup_roles.sql"),
		],
		{
			env: {
				...process.env,
				PGPASSWORD: env.get("DB_MIGRATION_PASSWORD") ?? "",
			},
		},
	);
}

async function dropProbeRole() {
	const { rows } = await owner().rawQuery(
		"select 1 from pg_roles where rolname = ?",
		[ROLE],
	);
	if (rows.length === 0) return;
	await owner().rawQuery(`drop owned by ${ROLE}`);
	await owner().rawQuery(`drop role ${ROLE}`);
}

async function roleFlags() {
	const { rows } = await owner().rawQuery(
		"select rolsuper, rolbypassrls, rolcreaterole, rolcanlogin from pg_roles where rolname = ?",
		[ROLE],
	);
	return rows[0];
}

// Roles are cluster-wide and psql is a separate session, so no test
// transaction here: each test cleans up after itself.
test.group("setup_roles.sql", (group) => {
	group.each.setup(() => dropProbeRole());
	group.each.teardown(() => dropProbeRole());

	test("creates a restricted login role, and running it twice is fine", async ({
		assert,
	}) => {
		await setupRoles(ROLE);
		await setupRoles(ROLE);

		assert.deepInclude(await roleFlags(), {
			rolsuper: false,
			rolbypassrls: false,
			rolcreaterole: false,
			rolcanlogin: true,
		});
	});

	test("normalizes a role that already exists with extra privileges", async ({
		assert,
	}) => {
		await owner().rawQuery(
			`create role ${ROLE} login superuser createrole bypassrls`,
		);

		await setupRoles(ROLE);

		assert.deepInclude(await roleFlags(), {
			rolsuper: false,
			rolbypassrls: false,
			rolcreaterole: false,
		});
	});

	test("grants data access but not schema changes", async ({ assert }) => {
		await setupRoles(ROLE);

		await owner().transaction(async (trx) => {
			await trx.rawQuery(`set local role ${ROLE}`);
			await trx.rawQuery("select count(*) from tenants");
			await assert.rejects(
				() => trx.rawQuery("create table td_probe_denied (id int)"),
				/permission denied/,
			);
		});
	});

	test("refuses identical app and owner names", async ({ assert }) => {
		await assert.rejects(
			() => setupRoles(env.get("DB_MIGRATION_USER")),
			/must be different roles/,
		);
	});
});
