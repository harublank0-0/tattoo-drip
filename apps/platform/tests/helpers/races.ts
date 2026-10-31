import { setTimeout as sleep } from "node:timers/promises";
import db from "@adonisjs/lucid/services/db";
import type Tenant from "#modules/tenancy/models/tenant";
import { dbClient } from "#services/db_context";
import { inTenant } from "#tests/helpers/tenants";

/**
 * Helpers for tests with real concurrency (two requests need two
 * connections and rows the other can see), so they run outside the global
 * transaction the other tests use. Their studios are committed and must be
 * removed again with `forgetStudio` in the group's teardown.
 */

export function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

/** How a promise ended, as a value, so a refusal can be asserted on. */
export type Settled<T> = { value: T } | { error: unknown };

export const settle = <T>(work: Promise<T>): Promise<Settled<T>> =>
	work.then(
		(value) => ({ value }),
		(error: unknown) => ({ error }),
	);

export const errorOf = (settled: Settled<unknown>) =>
	"error" in settled ? settled.error : undefined;

/**
 * Runs `fn` in the studio's context on a connection of its own and says
 * which backend that is, so the test can watch that one backend.
 */
export async function onItsOwnConnection<T>(
	tenant: Pick<Tenant, "id">,
	fn: () => Promise<T>,
) {
	const backend = deferred<number>();
	const outcome = settle(
		inTenant(tenant, async () => {
			const { rows } = await dbClient().rawQuery(
				"select pg_backend_pid() as pid",
			);
			backend.resolve(rows[0].pid as number);
			return fn();
		}),
	);
	return { pid: await backend.promise, outcome };
}

/**
 * Runs `fn` in the studio's context and keeps its transaction open,
 * uncommitted, after `fn` is done, until `release()`. `reached` resolves when
 * `fn` has ended (also when it failed), with its locks still held.
 */
export function heldOpen<T>(tenant: Pick<Tenant, "id">, fn: () => Promise<T>) {
	const reached = deferred();
	const release = deferred();
	const outcome = settle(
		inTenant(tenant, async () => {
			const value = await fn().finally(() => reached.resolve());
			await release.promise;
			return value;
		}),
	);
	return { reached: reached.promise, release: release.resolve, outcome };
}

/**
 * Waits until the backend `pid` waits for a lock another backend holds
 * (true), or its work has ended without waiting (false). Only this backend
 * counts: another session of the database waiting for a lock must not
 * release the test early.
 */
export async function waitUntilBlocked(pid: number, ended: Promise<unknown>) {
	let over = false;
	void ended.then(() => {
		over = true;
	});
	for (let attempt = 0; attempt < 200; attempt++) {
		if (over) return false;
		const { rows } = await db
			.connection("owner")
			.rawQuery(
				"select count(*)::int as n from pg_stat_activity where pid = ? and wait_event_type = 'Lock'",
				[pid],
			);
		if (rows[0].n > 0) return true;
		await sleep(25);
	}
	throw new Error(`backend ${pid} never waited for a lock`);
}

/**
 * Removes a committed studio and its accounts (their emails end in
 * `@<slug>.example`), whatever the test left.
 */
export async function forgetStudio(slug: string) {
	await db.connection("owner").transaction(async (trx) => {
		// The studio's rows go in any order; no foreign key stands in the way.
		await trx.rawQuery("set local session_replication_role = replica");
		const { rows: studios } = await trx.rawQuery(
			"select id from tenants where slug = ?",
			[slug],
		);
		const { rows: tables } = await trx.rawQuery(
			"select table_name from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id'",
		);
		for (const { id } of studios) {
			for (const { table_name: table } of tables) {
				await trx.rawQuery(`delete from "${table}" where tenant_id = ?`, [id]);
			}
			await trx.rawQuery("delete from tenants where id = ?", [id]);
		}
		await trx.rawQuery("delete from users where email like ?", [
			`%@${slug}.example`,
		]);
	});
}
