import { AsyncLocalStorage } from "node:async_hooks";
import logger from "@adonisjs/core/services/logger";
import db from "@adonisjs/lucid/services/db";
import type {
	QueryClientContract,
	TransactionClientContract,
} from "@adonisjs/lucid/types/database";

/**
 * Who is asking and for which studio. The database reads them as
 * `app.user_id` and `app.tenant_id` in its row-level security policies.
 */
export type DbContextValues = { userId?: string; tenantId?: string };

type Callback = () => void | Promise<void>;

/**
 * Work registered at one wrapper level. A released savepoint hands its
 * callbacks to its parent; the outermost wrapper runs what is left.
 */
class Level {
	commit: Callback[] = [];
	rollback: Callback[] = [];
}

/**
 * State shared by every level of one outermost transaction. The effective
 * settings are not here: they differ per level (see Store).
 */
type Root = {
	trx: TransactionClientContract;
	level: Level;
	/** True once abortRequestTransaction() rolled the root back. */
	detached: boolean;
};

type Store = {
	root: Root;
	/** The innermost transaction client: a savepoint inside nested levels. */
	client: TransactionClientContract;
	level: Level;
	/**
	 * The settings in force at this level. Each wrapper builds its child's
	 * values from its parent's, so concurrent branches cannot overwrite each
	 * other through shared state. Only the outermost level's values change
	 * after creation (setRequestContext).
	 */
	values: DbContextValues;
	/** withDbContext calls running directly under this level. */
	openContexts: number;
};

const storage = new AsyncLocalStorage<Store>();

function active(): Store | undefined {
	const store = storage.getStore();
	return store && !store.root.detached ? store : undefined;
}

function activeOrThrow(caller: string): Store {
	const store = active();
	if (!store) {
		throw new Error(
			`${caller} needs an open request or job transaction (withDbContext, withTransaction, or the dbContext middleware)`,
		);
	}
	return store;
}

/**
 * Runs after-transaction work. A failing callback is logged: the
 * transaction has already settled, so it cannot change the outcome.
 */
async function settle(callbacks: Callback[]) {
	for (const callback of callbacks) {
		try {
			await callback();
		} catch (err) {
			logger.error({ err }, "Work after a transaction failed");
		}
	}
}

/**
 * set_config(…, true) is SET LOCAL that accepts bind parameters. Empty
 * means "not set"; the app_*_id() functions turn it into NULL.
 */
async function applySettings(
	client: QueryClientContract,
	{ userId, tenantId }: DbContextValues,
) {
	await client.rawQuery(
		"select set_config('app.user_id', ?, true), set_config('app.tenant_id', ?, true)",
		[userId ?? "", tenantId ?? ""],
	);
}

async function readSettings(
	client: QueryClientContract,
): Promise<DbContextValues> {
	const { rows } = await client.rawQuery(
		"select current_setting('app.user_id', true) as user_id, current_setting('app.tenant_id', true) as tenant_id",
	);
	return {
		userId: rows[0].user_id || undefined,
		tenantId: rows[0].tenant_id || undefined,
	};
}

/**
 * Opens the outermost wrapper. In production that is a real transaction.
 * In tests the connection is already inside a global transaction, so it
 * is a savepoint, and the settings are put back afterwards because a
 * released savepoint would otherwise leave them set for the whole test.
 */
async function openRoot<T>(
	values: DbContextValues,
	fn: (trx: TransactionClientContract) => Promise<T>,
): Promise<T> {
	const base = db.connection();
	const outer = base.isTransaction ? await readSettings(base) : undefined;
	const level = new Level();
	const state: { root?: Root } = {};

	try {
		const result = await base.transaction(async (trx) => {
			const root: Root = { trx, level, detached: false };
			state.root = root;
			await applySettings(trx, values);
			const store: Store = {
				root,
				client: trx,
				level,
				values: { userId: values.userId, tenantId: values.tenantId },
				openContexts: 0,
			};
			return storage.run(store, () => fn(trx));
		});
		if (!state.root?.detached) {
			if (outer) await applySettings(base, outer);
			await settle(level.commit);
		}
		return result;
	} catch (error) {
		if (!state.root?.detached) await settle(level.rollback);
		throw error;
	}
}

/**
 * Runs `fn` in a savepoint under `parent`, with `values` in force for the
 * level. A failure rolls back only this level.
 */
async function runInSavepoint<T>(
	parent: Store,
	values: DbContextValues,
	fn: (trx: TransactionClientContract) => Promise<T>,
): Promise<T> {
	const level = new Level();
	let result: T;
	try {
		result = await parent.client.transaction(async (savepoint) =>
			storage.run(
				{
					root: parent.root,
					client: savepoint,
					level,
					values,
					openContexts: 0,
				},
				() => fn(savepoint),
			),
		);
	} catch (error) {
		await settle(level.rollback);
		throw error;
	}
	parent.level.commit.push(...level.commit);
	parent.level.rollback.push(...level.rollback);
	return result;
}

/**
 * Runs `fn` in a savepoint when a transaction is already open, else in a
 * new one. A failure rolls back only this level. The settings stay as they
 * are, so siblings may run side by side.
 */
export async function withTransaction<T>(
	fn: (trx: TransactionClientContract) => Promise<T>,
): Promise<T> {
	const parent = active();
	if (!parent) return openRoot({}, fn);

	return runInSavepoint(parent, { ...parent.values }, fn);
}

/**
 * Runs `fn` with these settings in its own transaction, or a savepoint
 * inside the open one. Values not passed are inherited from the level it
 * was called from. A failure rolls the savepoint back, so Postgres reverts
 * the settings and the original error surfaces. On success the caller's
 * values are set again, so nothing leaks into the rest of the transaction.
 *
 * Settings belong to the connection, so two of these cannot overlap under
 * one parent (a `Promise.all` of them): the second throws instead of
 * silently running with, or leaving behind, the first one's values.
 */
export async function withDbContext<T>(
	values: DbContextValues,
	fn: (trx: TransactionClientContract) => Promise<T>,
): Promise<T> {
	const parent = active();
	if (!parent) return openRoot(values, fn);

	if (parent.openContexts > 0) {
		throw new Error(
			"Overlapping withDbContext calls in one transaction: await one before starting the next (the database settings are per connection)",
		);
	}

	const next = {
		userId: values.userId ?? parent.values.userId,
		tenantId: values.tenantId ?? parent.values.tenantId,
	};
	parent.openContexts += 1;
	try {
		const result = await runInSavepoint(parent, next, async (trx) => {
			await applySettings(trx, next);
			return fn(trx);
		});
		if (!parent.root.detached)
			await applySettings(parent.client, parent.values);
		return result;
	} finally {
		parent.openContexts -= 1;
	}
}

/**
 * `fn` as is when a transaction is open (its settings already apply), else
 * in its own context. For code that can run after the request ended, such
 * as the error page's shared props.
 */
export function ensureDbContext<T>(
	values: DbContextValues,
	fn: () => Promise<T>,
): Promise<T> {
	return active() ? fn() : withDbContext(values, () => fn());
}

/**
 * The request's outermost transaction. It commits when `fn` resolves,
 * unless abortRequestTransaction() rolled it back first. It does not
 * wait for `fn` to throw: Adonis resolves `next()` even when the request
 * failed, and the exception handler signals the failure instead.
 */
export function runInRequestTransaction<T>(
	values: DbContextValues,
	fn: () => Promise<T>,
): Promise<T> {
	return openRoot(values, () => fn());
}

/**
 * Sets values for the rest of the open outermost transaction (the tenant
 * middleware uses it once the tenant is known). They stay set until the
 * transaction ends, and wrappers started afterwards inherit them. Only the
 * outermost level may call it: inside a nested wrapper the values would
 * apply to a savepoint that is about to be released.
 */
export async function setRequestContext(
	values: DbContextValues,
): Promise<void> {
	const store = activeOrThrow("setRequestContext");
	if (store.client !== store.root.trx) {
		throw new Error(
			"setRequestContext must be called from the outermost level of the request transaction, not inside withDbContext or withTransaction",
		);
	}
	if (values.userId !== undefined) store.values.userId = values.userId;
	if (values.tenantId !== undefined) store.values.tenantId = values.tenantId;
	await applySettings(store.client, store.values);
}

/**
 * Rolls back the request transaction, runs its rollback callbacks and
 * detaches it, so later code in the same request (the error page) runs
 * with no ambient transaction. Does nothing outside a request, and a
 * second call does nothing.
 */
export async function abortRequestTransaction(): Promise<void> {
	const store = active();
	if (!store) return;

	const { root } = store;
	root.detached = true;
	try {
		await root.trx.rollback();
	} catch (err) {
		logger.error({ err }, "Rolling back the request transaction failed");
	}
	const callbacks = root.level.rollback;
	root.level.rollback = [];
	root.level.commit = [];
	await settle(callbacks);
}

/**
 * Work to do once the outermost transaction has committed, such as
 * deleting a replaced file. Never do it right after a service's own
 * transaction returns: inside a request that is only a savepoint.
 */
export function afterCommit(fn: Callback): void {
	activeOrThrow("afterCommit").level.commit.push(fn);
}

/**
 * Work to do if the transaction rolls back, such as deleting a file that
 * was stored for a row that no longer exists.
 */
export function afterRollback(fn: Callback): void {
	activeOrThrow("afterRollback").level.rollback.push(fn);
}

/**
 * The open transaction, if any. The model adapter reads it.
 */
export function currentClient(): TransactionClientContract | undefined {
	return active()?.client;
}

/**
 * The open transaction, else the default connection. Raw queries that need
 * the request's context use this instead of the `db` service.
 */
export function dbClient(): QueryClientContract {
	return active()?.client ?? db.connection();
}
