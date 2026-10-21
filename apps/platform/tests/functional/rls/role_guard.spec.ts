import db from "@adonisjs/lucid/services/db";
import { test } from "@japa/runner";
import { assertRestrictedDbRole } from "#services/db_role_guard";
import env from "#start/env";
import { boot } from "#tests/helpers/boot";

const owner = () => db.connection("owner");
const PROBES = ["td_probe_member", "td_probe_owner", "td_probe_bypass"];

async function dropProbes() {
	await owner().rawQuery("drop table if exists td_probe_table");
	for (const role of PROBES) {
		await owner().rawQuery(`drop role if exists ${role}`);
	}
}

/**
 * Evaluates the guard as `role`, without logging in as it.
 */
function guardAs(role: string) {
	return owner().transaction(async (trx) => {
		await trx.rawQuery(`set local role ${role}`);
		await assertRestrictedDbRole(trx);
	});
}

test.group("assertRestrictedDbRole", (group) => {
	group.each.setup(() => dropProbes());
	group.each.teardown(() => dropProbes());

	test("accepts the app connection", async ({ assert }) => {
		await assert.doesNotReject(() => assertRestrictedDbRole(db.connection()));
	});

	test("rejects a superuser", async ({ assert }) => {
		await assert.rejects(() => assertRestrictedDbRole(owner()), /superuser/);
	});

	test("rejects a role with BYPASSRLS", async ({ assert }) => {
		await owner().rawQuery("create role td_probe_bypass nologin bypassrls");
		await assert.rejects(() => guardAs("td_probe_bypass"), /BYPASSRLS/);
	});

	test("rejects a role that owns a table in public", async ({ assert }) => {
		await owner().rawQuery("create role td_probe_owner nologin");
		await owner().rawQuery("create table td_probe_table (id int)");
		await owner().rawQuery(
			"alter table td_probe_table owner to td_probe_owner",
		);
		await assert.rejects(() => guardAs("td_probe_owner"), /owns a table/);
	});

	test("rejects a member of a role that owns a table", async ({ assert }) => {
		await owner().rawQuery("create role td_probe_owner nologin");
		await owner().rawQuery("create table td_probe_table (id int)");
		await owner().rawQuery(
			"alter table td_probe_table owner to td_probe_owner",
		);
		await owner().rawQuery(
			"create role td_probe_member nologin in role td_probe_owner",
		);
		await assert.rejects(() => guardAs("td_probe_member"), /owns a table/);
	});
});

function bootAsOwner(args: string[]) {
	return boot(args, {
		DB_USER: env.get("DB_MIGRATION_USER"),
		DB_PASSWORD: env.get("DB_MIGRATION_PASSWORD") ?? "",
	});
}

test.group("boot guard", () => {
	test("the worker refuses to start as the owner role", async ({ assert }) => {
		const { exitCode, killed, output } = await bootAsOwner([
			"ace.js",
			"queue:work",
		]);

		assert.isFalse(killed);
		assert.equal(exitCode, 1);
		assert.match(output, /is a superuser/);
		assert.notMatch(output, /Starting worker/);
	}).timeout(40_000);

	// The command reads one studio's numbers at a time and leans on RLS to
	// keep each its own (TAT-70), so it is guarded like the worker.
	test("metrics:pilot refuses to run as the owner role", async ({ assert }) => {
		const { exitCode, killed, output } = await bootAsOwner([
			"ace.js",
			"metrics:pilot",
		]);

		assert.isFalse(killed);
		assert.equal(exitCode, 1);
		assert.match(output, /is a superuser/);
		assert.notMatch(output, /Pilot numbers/);
	}).timeout(40_000);

	// The guard checks the default (app role) connection only: the list of
	// studios still comes through the command's own owner connection.
	test("metrics:pilot runs as the app role and still lists studios as the owner", async ({
		assert,
	}) => {
		const { exitCode, killed, output } = await boot(
			["ace.js", "metrics:pilot", "--days=1"],
			{},
		);

		assert.isFalse(killed);
		assert.equal(exitCode, 0);
		assert.match(output, /Pilot numbers for the last 1 days/);
		assert.match(output, /No studios yet\.|All studios \(\d+\)/);
	}).timeout(40_000);

	test("the web server refuses to listen as the owner role", async ({
		assert,
	}) => {
		const { exitCode, killed, output } = await bootAsOwner([
			"--import",
			"@poppinss/ts-exec",
			"bin/server.ts",
		]);

		assert.isFalse(killed);
		assert.equal(exitCode, 1);
		assert.match(output, /is a superuser/);
		assert.notMatch(output, /started HTTP server/);
	}).timeout(40_000);

	// Codegen warms the app up in the web environment but never runs it, and
	// it is a documented step after route changes: it must not need the
	// database, nor hang on the connection the guard would have opened.
	test("codegen does not run the guard or need the database", async ({
		assert,
	}) => {
		// Codegen takes a couple of seconds: a hung one fails the test in 15.
		const { exitCode, killed, output } = await boot(
			["ace.js", "codegen"],
			{ DB_PORT: "55999" },
			15_000,
		);

		assert.isFalse(killed);
		assert.notMatch(output, /ECONNREFUSED/);
		assert.equal(exitCode, 0);
		assert.match(output, /Codegen files generated/);
	}).timeout(40_000);
});
