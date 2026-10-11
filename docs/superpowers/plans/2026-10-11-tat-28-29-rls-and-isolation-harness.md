# Row-level security and the isolation harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PostgreSQL row-level security the second tenant-isolation layer, and prove it with a cross-tenant isolation harness plus guards that stop an unprotected table or endpoint from merging.

**Architecture:** Every authenticated request, and every tenant job, runs in one transaction that carries `app.user_id` and `app.tenant_id` (set with `set_config(…, true)`) in an `AsyncLocalStorage` store. A Lucid adapter hands that transaction to every model query. The app connects as a restricted role (`tattoo_drip_app`); migrations run as the owner. Policies read the settings through two SQL functions and fail closed when nothing is set. Work is ordered so the app is RLS-ready (context everywhere, tests included) before the policy migration flips the switch.

**Tech Stack:** AdonisJS 7, Lucid 22.4.2, `@boringnode/queue` 0.6.0 / `@adonisjs/queue` 0.6.2, PostgreSQL 18, Japa, VineJS, Biome, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-09-tat-28-29-rls-and-isolation-harness-design.md` (approved). Read it before starting; this plan implements it, with one amendment (Task 4): `TenantJob` lives in `app/services/tenant_job.ts`, not `app/jobs/`, because the worker registers the default export of every file in the jobs folders as a job.

## Global Constraints

- PostgreSQL 18. Primary keys are UUIDv7 from `uuidv7()`; instants are `timestamptz`.
- Context settings are `app.user_id` and `app.tenant_id`, written with `select set_config('app.…', $1, true)` (transaction-local, accepts bind parameters). SQL functions `app_tenant_id()` and `app_user_id()` are `STABLE` and return `nullif(current_setting('app.…', true), '')::uuid`. Policies call them as `(select app_tenant_id())`.
- Roles: owner (`postgres` in dev and CI) owns the tables and runs migrations through the Lucid connection `owner`; app role `tattoo_drip_app` is `LOGIN NOSUPERUSER NOBYPASSRLS` with DML grants only, on the default connection `pg`. `DB_USER` / `DB_PASSWORD` are the app role; `DB_MIGRATION_USER` / `DB_MIGRATION_PASSWORD` are the owner. Migrations run with `--connection=owner`, wrapped by `pnpm migrate`.
- Tables get `ENABLE ROW LEVEL SECURITY`, never `FORCE`. Policies use the default `TO PUBLIC`. The standard policy is named `tenant_isolation` and always has an explicit `WITH CHECK`.
- Boot guard: the web server, the worker (`queue:work`) and the test runner refuse to start if the connected role is a superuser, has `BYPASSRLS`, owns a table in `public`, or is a member of a role that does. Other ace commands skip it.
- `users` stays outside RLS. Tenant identity comes from the URL only; `tenant_id` never appears in validators.
- Never edit `database/schema.ts`, `.adonisjs/`, or a migration that already ran. Run `node ace codegen` after route changes.
- pnpm only; Biome, not ESLint or Prettier; tabs and double quotes as in the existing code. `@inject()` dependencies stay value imports (keep the `useImportType` suppression).
- Conventional Commits with scope `platform`. End every commit message with the Co-Authored-By trailer the session specifies.
- Run tests from `apps/platform` with `PORT=3402` (port 3333 is taken on the author's machine). Functional tests need migrated PostgreSQL. Narrow runs: `PORT=3402 node ace test functional --files=<name>`.

## Review Focus

Failure modes the spec implies but no obvious test would reach. Each has a test in the task named.

1. An `afterCommit` callback that throws: the request or job still succeeds and the error is logged (Task 1).
2. `abortRequestTransaction()` called twice, or outside any request: the repeat and the outside call do nothing (Task 1).
3. A request that writes and then fails validation, not a crash: nothing from it is committed (Task 2).
4. `setup_roles.sql` run twice, run against a role that already exists with extra privileges, or run with identical app and owner names: idempotent, normalizes the role, refuses the last (Task 5).
5. A role that owns no table itself but is a member of a role that does: the boot guard still refuses it (Task 5).

---

## File Structure

Create (all under `apps/platform/` unless noted):

| File | Responsibility |
|---|---|
| `app/services/db_context.ts` | The `AsyncLocalStorage` store, `withDbContext`, `withTransaction`, `afterCommit` / `afterRollback`, request transaction and abort |
| `providers/db_context_provider.ts` | Installs the Lucid adapter that returns the ambient transaction; runs the boot guard |
| `app/services/db_role_guard.ts` | `assertRestrictedDbRole(client)` |
| `app/services/tenant_job.ts` | `TenantJob` base class |
| `app/middleware/db_context_middleware.ts` | Opens the request transaction and sets `app.user_id` |
| `database/setup_roles.sql` | Creates and normalizes the app role, grants |
| `database/helpers/tenant_rls.ts` | `enableTenantRls`, `disableTenantRls`, `tenantReference` |
| `database/migrations/1791570000000_enable_row_level_security.ts` | Functions, policies, unique keys |
| `tests/support/test_routes.ts` | Test-only routes under `/__test/db`, registered by the functional suite only |
| `tests/helpers/worker.ts` | Runs jobs through the real queue `Worker` |
| `tests/isolation/cases.ts`, `tests/helpers/isolation.ts` | Declarative isolation cases and the assertion helper |
| `tests/functional/db_context/*.spec.ts`, `tests/functional/rls/*.spec.ts`, `tests/functional/isolation/*.spec.ts`, `tests/functional/queue/tenant_job.spec.ts` | New specs |
| `../../docker/postgres/init/10-setup-roles.sh`, `../../.github/pull_request_template.md` | At the repository root |

Modify: `adonisrc.ts`, `config/database.ts`, `start/env.ts`, `.env.example`, `start/kernel.ts`, `start/routes.ts`, `package.json`, `app/middleware/tenant_middleware.ts`, `app/middleware/inertia_middleware.ts`, `app/exceptions/handler.ts`, `app/modules/tenancy/services/tenancy_service.ts`, `app/modules/tenancy/models/tenant.ts`, `app/modules/payments/services/payment_method_service.ts`, `app/modules/tenancy/validators/tenant.ts`, `app/controllers/onboarding_controller.ts`, `tests/bootstrap.ts`, `tests/helpers/tenants.ts`, the nine specs that create tenant rows, `../../docker-compose.yml`, `../../.github/workflows/ci.yml`, the docs listed in Task 9.

---

### Task 1: Context core and the Lucid adapter

Everything else depends on this module, and its two riskiest assumptions are tested here first: the adapter covers queries and preloads, and settings and callbacks behave across savepoints.

**Files:**
- Create: `apps/platform/app/services/db_context.ts`
- Create: `apps/platform/providers/db_context_provider.ts`
- Modify: `apps/platform/adonisrc.ts` (providers list)
- Test: `apps/platform/tests/functional/db_context/db_context.spec.ts`

**Interfaces:**
- Consumes: Lucid `db` service, `logger` service.
- Produces (from `#services/db_context`):
  - `type DbContextValues = { userId?: string; tenantId?: string }`
  - `withDbContext<T>(values: DbContextValues, fn: (trx: TransactionClientContract) => Promise<T>): Promise<T>` — own transaction, or a savepoint inside the ambient one; sets and restores settings.
  - `withTransaction<T>(fn: (trx: TransactionClientContract) => Promise<T>): Promise<T>` — savepoint inside an ambient transaction, else a root transaction.
  - `ensureDbContext<T>(values: DbContextValues, fn: () => Promise<T>): Promise<T>` — runs `fn` as is inside an ambient transaction, else in `withDbContext`.
  - `runInRequestTransaction<T>(values: DbContextValues, fn: () => Promise<T>): Promise<T>`
  - `setRequestContext(values: DbContextValues): Promise<void>` — sets values for the rest of the open root; throws outside one.
  - `abortRequestTransaction(): Promise<void>` — rolls back the root, runs its rollback callbacks, detaches it; no-op outside a request or when called twice.
  - `afterCommit(fn: () => void | Promise<void>): void`, `afterRollback(fn: () => void | Promise<void>): void` — throw outside a wrapper.
  - `dbClient(): QueryClientContract` — the ambient transaction, else `db.connection()`.
  - `currentClient(): TransactionClientContract | undefined`
- Produces (from `#providers/db_context_provider`): `ContextAdapter`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/db_context/db_context.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { BaseModel } from "@adonisjs/lucid/orm";
import type { QueryClientContract } from "@adonisjs/lucid/types/database";
import { test } from "@japa/runner";
import User from "#models/user";
import Tenant from "#modules/tenancy/models/tenant";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import {
	abortRequestTransaction,
	afterCommit,
	afterRollback,
	dbClient,
	runInRequestTransaction,
	setRequestContext,
	withDbContext,
	withTransaction,
} from "#services/db_context";
import { studioWithOwner } from "#tests/helpers/tenants";

const USER = "00000000-0000-4000-8000-000000000001";
const TENANT = "00000000-0000-4000-8000-000000000002";

async function setting(name: "app.user_id" | "app.tenant_id") {
	const { rows } = await dbClient().rawQuery(
		"select current_setting(?, true) as value",
		[name],
	);
	return rows[0].value || null;
}

test.group("db_context settings", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("withDbContext sets the settings and puts the previous ones back", async ({
		assert,
	}) => {
		assert.isNull(await setting("app.tenant_id"));

		await withDbContext({ userId: USER, tenantId: TENANT }, async () => {
			assert.equal(await setting("app.user_id"), USER);
			assert.equal(await setting("app.tenant_id"), TENANT);
		});

		assert.isNull(await setting("app.user_id"));
		assert.isNull(await setting("app.tenant_id"));
	});

	test("a nested context inherits the outer values and restores them", async ({
		assert,
	}) => {
		await withDbContext({ userId: USER }, async () => {
			await withDbContext({ tenantId: TENANT }, async () => {
				assert.equal(await setting("app.user_id"), USER);
				assert.equal(await setting("app.tenant_id"), TENANT);
			});
			assert.equal(await setting("app.user_id"), USER);
			assert.isNull(await setting("app.tenant_id"));
		});
	});

	test("the original error surfaces when the function fails, and the settings revert", async ({
		assert,
	}) => {
		await withDbContext({ userId: USER }, async () => {
			await assert.rejects(
				() =>
					withDbContext({ tenantId: TENANT }, async (trx) => {
						await trx.rawQuery("select 1/0");
					}),
				/division by zero/,
			);
			assert.isNull(await setting("app.tenant_id"));
			assert.equal(await setting("app.user_id"), USER);
		});
	});

	test("a failing statement aborts only its savepoint", async ({ assert }) => {
		await withDbContext({}, async () => {
			await assert.rejects(
				() => withTransaction((trx) => trx.rawQuery("select 1/0")),
				/division by zero/,
			);
			const { rows } = await dbClient().rawQuery("select 1 as ok");
			assert.equal(rows[0].ok, 1);
		});
	});

	test("setRequestContext outside a request throws", async ({ assert }) => {
		await assert.rejects(
			() => setRequestContext({ tenantId: TENANT }),
			/setRequestContext/,
		);
	});
});

test.group("db_context callbacks", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("afterCommit runs after the outermost wrapper commits, afterRollback after it fails", async ({
		assert,
	}) => {
		const calls: string[] = [];
		const register = () => {
			afterCommit(() => {
				calls.push("commit");
			});
			afterRollback(() => {
				calls.push("rollback");
			});
		};

		await withDbContext({}, async () => register());
		assert.deepEqual(calls, ["commit"]);

		calls.length = 0;
		await assert.rejects(
			() =>
				withDbContext({}, async () => {
					register();
					throw new Error("boom");
				}),
			"boom",
		);
		assert.deepEqual(calls, ["rollback"]);
	});

	test("a released savepoint hands its callbacks to the parent", async ({
		assert,
	}) => {
		const calls: string[] = [];
		await withDbContext({}, async () => {
			await withTransaction(async () => {
				afterCommit(() => {
					calls.push("commit");
				});
			});
			assert.deepEqual(calls, []);
		});
		assert.deepEqual(calls, ["commit"]);
	});

	test("a rolled back savepoint drops commit callbacks and runs rollback callbacks at once", async ({
		assert,
	}) => {
		const calls: string[] = [];
		await withDbContext({}, async () => {
			await assert.rejects(
				() =>
					withTransaction(async () => {
						afterCommit(() => {
							calls.push("commit");
						});
						afterRollback(() => {
							calls.push("rollback");
						});
						throw new Error("inner");
					}),
				"inner",
			);
			assert.deepEqual(calls, ["rollback"]);
		});
		assert.deepEqual(calls, ["rollback"]);
	});

	test("a callback that throws is logged and does not change the outcome", async ({
		assert,
	}) => {
		const value = await withDbContext({}, async () => {
			afterCommit(() => {
				throw new Error("cleanup failed");
			});
			return 42;
		});
		assert.equal(value, 42);
	});

	test("registering a callback outside a wrapper throws", ({ assert }) => {
		assert.throws(() => afterCommit(() => {}), /open request or job transaction/);
		assert.throws(
			() => afterRollback(() => {}),
			/open request or job transaction/,
		);
	});
});

test.group("db_context request transaction", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a request transaction commits and fires afterCommit", async ({
		assert,
	}) => {
		const calls: string[] = [];
		await runInRequestTransaction({ userId: USER }, async () => {
			assert.equal(await setting("app.user_id"), USER);
			await setRequestContext({ tenantId: TENANT });
			assert.equal(await setting("app.tenant_id"), TENANT);
			afterCommit(() => {
				calls.push("commit");
			});
		});
		assert.deepEqual(calls, ["commit"]);
		assert.isNull(await setting("app.user_id"));
		assert.isNull(await setting("app.tenant_id"));
	});

	test("abortRequestTransaction rolls back, runs rollback callbacks, detaches, and is idempotent", async ({
		assert,
	}) => {
		const calls: string[] = [];
		await runInRequestTransaction({ userId: USER }, async () => {
			// A user, not a tenant: users are outside row-level security, so this
			// test means the same before and after the policies are on.
			await User.create({
				email: "gone@example.com",
				password: "secret-password",
			});
			afterCommit(() => {
				calls.push("commit");
			});
			afterRollback(() => {
				calls.push("rollback");
			});

			await abortRequestTransaction();
			await abortRequestTransaction();

			assert.throws(() => afterCommit(() => {}), /open request/);
		});

		assert.deepEqual(calls, ["rollback"]);
		assert.isNull(await User.findBy("email", "gone@example.com"));
	});

	test("abortRequestTransaction outside a request does nothing", async () => {
		await abortRequestTransaction();
	});
});

test.group("Model adapter", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("queries and preloads inside a context use the context's transaction", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			assert.strictEqual(TenantMembership.query().client, trx);

			const [membership] = await TenantMembership.query().preload("tenant");
			assert.strictEqual(membership.$options?.client, trx);
			assert.strictEqual(membership.tenant.$options?.client, trx);
		});
	});

	test("a plain client from before the context joins the context's transaction", async ({
		assert,
	}) => {
		await withDbContext({}, async (trx) => {
			const plain = {
				isTransaction: false,
				connectionName: trx.connectionName,
			} as unknown as QueryClientContract;

			assert.strictEqual(
				BaseModel.$adapter.modelConstructorClient(Tenant, { client: plain }),
				trx,
			);
		});
	});

	test("an explicit transaction client keeps winning", async ({ assert }) => {
		await withDbContext({}, async (trx) => {
			const explicit = {
				isTransaction: true,
				connectionName: trx.connectionName,
			} as unknown as QueryClientContract;

			assert.strictEqual(
				BaseModel.$adapter.modelConstructorClient(Tenant, { client: explicit }),
				explicit,
			);
		});
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `apps/platform`): `PORT=3402 node ace test functional --files=db_context.spec.ts`
Expected: FAIL, the spec cannot resolve `#services/db_context`.

- [ ] **Step 3: Write the context module**

Create `apps/platform/app/services/db_context.ts`:

```ts
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
 * State shared by every level of one outermost transaction.
 */
type Root = {
	trx: TransactionClientContract;
	level: Level;
	userId?: string;
	tenantId?: string;
	/** True once abortRequestTransaction() rolled the root back. */
	detached: boolean;
};

type Store = {
	root: Root;
	/** The innermost transaction client: a savepoint inside nested levels. */
	client: TransactionClientContract;
	level: Level;
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
			const root: Root = { trx, level, detached: false, ...values };
			state.root = root;
			await applySettings(trx, values);
			return storage.run({ root, client: trx, level }, () => fn(trx));
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
 * Runs `fn` in a savepoint when a transaction is already open, else in a
 * new one. A failure rolls back only this level.
 */
export async function withTransaction<T>(
	fn: (trx: TransactionClientContract) => Promise<T>,
): Promise<T> {
	const parent = active();
	if (!parent) return openRoot({}, fn);

	const level = new Level();
	let result: T;
	try {
		result = await parent.client.transaction(async (savepoint) =>
			storage.run({ root: parent.root, client: savepoint, level }, () =>
				fn(savepoint),
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
 * Runs `fn` with these settings in its own transaction, or a savepoint
 * inside the open one. Values not passed are inherited. A failure rolls
 * the savepoint back, so Postgres reverts the settings and the original
 * error surfaces. On success the previous values are set again, so
 * nothing leaks into the rest of the transaction.
 */
export async function withDbContext<T>(
	values: DbContextValues,
	fn: (trx: TransactionClientContract) => Promise<T>,
): Promise<T> {
	const parent = active();
	if (!parent) return openRoot(values, fn);

	const { root } = parent;
	const previous = { userId: root.userId, tenantId: root.tenantId };
	const next = {
		userId: values.userId ?? previous.userId,
		tenantId: values.tenantId ?? previous.tenantId,
	};
	try {
		const result = await withTransaction(async (trx) => {
			Object.assign(root, next);
			await applySettings(trx, next);
			return fn(trx);
		});
		if (!root.detached) await applySettings(parent.client, previous);
		return result;
	} finally {
		Object.assign(root, previous);
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
 * transaction ends.
 */
export async function setRequestContext(
	values: DbContextValues,
): Promise<void> {
	const store = activeOrThrow("setRequestContext");
	const { root } = store;
	if (values.userId !== undefined) root.userId = values.userId;
	if (values.tenantId !== undefined) root.tenantId = values.tenantId;
	await applySettings(store.client, root);
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
```

- [ ] **Step 4: Write the adapter provider and register it**

Create `apps/platform/providers/db_context_provider.ts`:

```ts
import type { ApplicationService } from "@adonisjs/core/types";
import { Adapter, BaseModel } from "@adonisjs/lucid/orm";
import type { DatabaseContract } from "@adonisjs/lucid/types/database";
import type { LucidModel, ModelAdapterOptions } from "@adonisjs/lucid/types/model";
import { currentClient } from "#services/db_context";

/**
 * Lucid's adapter, except that inside a request or job transaction every
 * model query uses that transaction. Instances loaded before it (such as
 * `auth.user`) keep the plain pool client in `$options.client`, so a plain
 * client is replaced; an explicit transaction client still wins, and
 * models on another connection are left alone.
 */
export class ContextAdapter extends Adapter {
	constructor(private database: DatabaseContract) {
		super(database);
	}

	override modelConstructorClient(
		modelConstructor: LucidModel,
		options?: ModelAdapterOptions,
	) {
		const ambient = currentClient();
		if (ambient && !options?.client?.isTransaction) {
			const connection =
				options?.connection ??
				modelConstructor.connection ??
				this.database.primaryConnectionName;
			if (connection === ambient.connectionName) return ambient;
		}
		return super.modelConstructorClient(modelConstructor, options);
	}
}

export default class DbContextProvider {
	constructor(protected app: ApplicationService) {}

	/**
	 * After the database provider, which installs the stock adapter.
	 */
	async boot() {
		const db = await this.app.container.make("lucid.db");
		BaseModel.$adapter = new ContextAdapter(db);
	}
}
```

In `apps/platform/adonisrc.ts`, add the provider right after the Lucid one:

```ts
		() => import("@adonisjs/lucid/database_provider"),
		() => import("#providers/db_context_provider"),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `PORT=3402 node ace test functional --files=db_context.spec.ts`
Expected: all tests PASS. If `membership.$options?.client` is not the transaction, the adapter is not covering preloads: stop and use the fallback in the spec's open risks (override `query()` on a shared base model).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm typecheck` (from `apps/platform`). Expected: no errors.

```bash
git add apps/platform/app/services/db_context.ts apps/platform/providers/db_context_provider.ts apps/platform/adonisrc.ts apps/platform/tests/functional/db_context/db_context.spec.ts
git commit -m "feat(platform): add request transaction context and model adapter"
```

---

### Task 2: Request middleware, exception handler and tenant context

Wires Task 1 into HTTP. The exception handler is what rolls a failed request back, so the real-request tests here also check the riskiest assumption: the `AsyncLocalStorage` store is still present when the handler runs.

**Files:**
- Create: `apps/platform/app/middleware/db_context_middleware.ts`
- Create: `apps/platform/tests/support/test_routes.ts`
- Modify: `apps/platform/start/kernel.ts`, `apps/platform/start/routes.ts`, `apps/platform/app/exceptions/handler.ts`, `apps/platform/app/middleware/tenant_middleware.ts`, `apps/platform/app/middleware/inertia_middleware.ts`, `apps/platform/tests/bootstrap.ts`
- Modify: `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts` (route-group assertions)
- Test: `apps/platform/tests/functional/db_context/request_transaction.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`runInRequestTransaction`, `setRequestContext`, `abortRequestTransaction`, `ensureDbContext`, `afterCommit`, `afterRollback`, `dbClient`).
- Produces: named middleware `middleware.dbContext()`; every authenticated route group runs `auth`, then `dbContext`, then (for tenant routes) `tenant`.

- [ ] **Step 1: Add the test-only routes and register them for the functional suite**

Create `apps/platform/tests/support/test_routes.ts`:

```ts
import router from "@adonisjs/core/services/router";
import { errors } from "@vinejs/vine";
import User from "#models/user";
import { afterCommit, afterRollback, dbClient } from "#services/db_context";
import { middleware } from "#start/kernel";

/**
 * Routes that exist only in the test run (tests/bootstrap.ts imports this
 * before the server starts). Each writes a row, registers both callbacks,
 * then succeeds or fails in a different way. The row is a user: the users
 * table is outside row-level security, so these tests mean the same before
 * and after the policies are on.
 */
export const hooks: string[] = [];

function register() {
	afterCommit(() => {
		hooks.push("commit");
	});
	afterRollback(() => {
		hooks.push("rollback");
	});
}

async function write(name: string) {
	await User.create({
		email: `${name}@example.com`,
		password: "secret-password",
	});
	register();
}

router
	.group(() => {
		router.post("ok", async ({ response }) => {
			await write("route-ok");
			return response.noContent();
		});
		router.post("throws", async () => {
			await write("route-throws");
			throw new Error("boom");
		});
		router.post("sql-error", async () => {
			await write("route-sql-error");
			await dbClient().rawQuery("select 1/0");
		});
		router.post("invalid", async () => {
			await write("route-invalid");
			throw new errors.E_VALIDATION_ERROR([
				{ field: "label", message: "Enter a label", rule: "required" },
			]);
		});
		router.get("settings", async ({ response }) => {
			const { rows } = await dbClient().rawQuery(
				"select current_setting('app.user_id', true) as user_id, current_setting('app.tenant_id', true) as tenant_id",
			);
			return response.json(rows[0]);
		});
	})
	.prefix("/__test/db")
	.use([middleware.auth(), middleware.dbContext()]);
```

In `apps/platform/tests/bootstrap.ts`, replace the `configureSuite` body so the routes are registered before the server starts and commits the router:

```ts
export const configureSuite: Config["configureSuite"] = (suite) => {
	if (["browser", "functional", "e2e"].includes(suite.name)) {
		return suite.setup(async () => {
			await import("#tests/support/test_routes");
			return testUtils.httpServer().start();
		});
	}
};
```

- [ ] **Step 2: Write the failing request tests**

Create `apps/platform/tests/functional/db_context/request_transaction.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import { studioWithOwner } from "#tests/helpers/tenants";
import { hooks } from "#tests/support/test_routes";

test.group("Request transaction", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => {
		hooks.length = 0;
	});

	test("a successful request commits and fires afterCommit", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.post("/__test/db/ok")
			.withCsrfToken()
			.loginAs(owner);

		response.assertStatus(204);
		assert.isNotNull(await User.findBy("email", "route-ok@example.com"));
		assert.deepEqual(hooks, ["commit"]);
	});

	test("an application error rolls back, fires afterRollback and still renders", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.post("/__test/db/throws")
			.withCsrfToken()
			.loginAs(owner);

		response.assertStatus(500);
		assert.isNull(await User.findBy("email", "route-throws@example.com"));
		assert.deepEqual(hooks, ["rollback"]);
	});

	test("an uncaught SQL error rolls back and the error page still renders", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.post("/__test/db/sql-error")
			.withCsrfToken()
			.loginAs(owner);

		response.assertStatus(500);
		assert.isNull(await User.findBy("email", "route-sql-error@example.com"));
		assert.deepEqual(hooks, ["rollback"]);
	});

	test("a validation error after a write rolls the write back", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		await client
			.post("/__test/db/invalid")
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assert.isNull(await User.findBy("email", "route-invalid@example.com"));
		assert.deepEqual(hooks, ["rollback"]);
	});

	test("the request sees the user's id and no tenant on a non-tenant route", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client.get("/__test/db/settings").loginAs(owner);

		response.assertStatus(200);
		assert.equal(response.body().user_id, owner.id);
		assert.notOk(response.body().tenant_id);
	});

	test("a tenant page sets the tenant, and the next request does not inherit it", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		await client.get("/t/black-needle").loginAs(owner);
		const response = await client.get("/__test/db/settings").loginAs(owner);

		assert.equal(response.body().user_id, owner.id);
		assert.notEqual(response.body().tenant_id, tenant.id);
		assert.notOk(response.body().tenant_id);
	});
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `PORT=3402 node ace test functional --files=request_transaction.spec.ts`
Expected: FAIL, `middleware.dbContext is not a function` while loading `tests/support/test_routes.ts`.

- [ ] **Step 4: Add the middleware and register it**

Create `apps/platform/app/middleware/db_context_middleware.ts`:

```ts
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { runInRequestTransaction } from "#services/db_context";

/**
 * Runs the rest of an authenticated request in one transaction that
 * carries the signed-in user's id for the database's row-level security
 * policies. The tenant middleware adds the tenant once it knows it.
 *
 * It commits when the response succeeds. A failed request is rolled back
 * by the exception handler (abortRequestTransaction), not here: Adonis
 * resolves `next()` even when a controller threw, so waiting for a throw
 * would commit failed requests.
 *
 * Use right after the auth middleware. Public routes get no transaction.
 */
export default class DbContextMiddleware {
	async handle(ctx: HttpContext, next: NextFn) {
		const user = ctx.auth.getUserOrFail();
		return runInRequestTransaction({ userId: user.id }, () => next());
	}
}
```

In `apps/platform/start/kernel.ts`, add to `router.named`:

```ts
	auth: () => import("#middleware/auth_middleware"),
	dbContext: () => import("#middleware/db_context_middleware"),
	tenant: () => import("#middleware/tenant_middleware"),
```

In `apps/platform/start/routes.ts`, change the two `.use(...)` calls:

```ts
	.prefix("/t/:tenant")
	.use([middleware.auth(), middleware.dbContext(), middleware.tenant()]);
```

```ts
	.use([middleware.auth(), middleware.dbContext()]);
```

(the second belongs to the last group: `dashboard`, `logout`, `onboarding`).

- [ ] **Step 5: Roll back failed requests in the exception handler**

In `apps/platform/app/exceptions/handler.ts`, import the function and call it first in `handle()`:

```ts
import { abortRequestTransaction } from "#services/db_context";
```

```ts
	async handle(error: unknown, ctx: HttpContext) {
		// Any exception rolls the request back before anything renders, so
		// earlier writes never commit after a failure, and the error page
		// runs with no ambient transaction.
		await abortRequestTransaction();
		if (isPathTraversal(error)) {
```

- [ ] **Step 6: Set the tenant in the tenant middleware and keep the error-page switcher working**

In `apps/platform/app/middleware/tenant_middleware.ts`, import and call `setRequestContext` after the membership is resolved:

```ts
import { setRequestContext } from "#services/db_context";
```

```ts
		ctx.tenant = found.tenant;
		ctx.membership = found.membership;
		// Throws if the dbContext middleware did not run before this one.
		await setRequestContext({ tenantId: found.tenant.id });
```

Update the class comment above `TenantMiddleware`: add "Use after `auth` and `dbContext`."

In `apps/platform/app/middleware/inertia_middleware.ts`, wrap the `tenantsFor` read (error pages render after the request transaction was rolled back, with no ambient context):

```ts
import { ensureDbContext } from "#services/db_context";
```

```ts
		const tenants =
			tenant && auth?.user
				? await ensureDbContext(
						{ userId: auth.user.id, tenantId: tenant.id },
						async () =>
							(await ctx.containerResolver.make(TenancyService)).tenantsFor(
								auth.user as User,
							),
					)
				: undefined;
```

and add `import type User from "#models/user";` at the top.

- [ ] **Step 7: Make the route-group tests require the new middleware**

In `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts`, in the `every /t/:tenant route runs auth, then the tenant check` test, rename it to `every /t/:tenant route runs auth, then the request transaction, then the tenant check` and add inside the loop, after the existing assertions:

```ts
			const dbContext = names.indexOf("dbContext");
			assert.isAbove(dbContext, names.indexOf("auth"), route.pattern);
			assert.isBelow(dbContext, names.indexOf("tenant"), route.pattern);
```

In the settings-routes test, add inside its loop, after `const role = …`:

```ts
				const dbContext = names.indexOf("dbContext");
				assert.isAbove(dbContext, auth, route.pattern);
				assert.isBelow(dbContext, tenant, route.pattern);
```

- [ ] **Step 8: Run the new tests, then the whole functional suite**

Run: `PORT=3402 node ace test functional --files=request_transaction.spec.ts`
Expected: PASS. If the two rollback tests fail because the rows are still there, the `AsyncLocalStorage` store is missing when the handler runs (spec open risk 5): in `DbContextMiddleware`, also store the transaction on `ctx` (`ctx.dbRoot`) and have the handler read it from `ctx` instead.

Run: `PORT=3402 node ace test functional`
Expected: all functional tests PASS.

- [ ] **Step 9: Typecheck, regenerate, commit**

Run: `pnpm typecheck && node ace codegen`
Expected: no type errors. `git status` shows no changes under `.adonisjs/` (if it does, include them).

```bash
git add apps/platform
git commit -m "feat(platform): run authenticated requests in one tenant-aware transaction"
```

### Task 3: Services join the request transaction

Moves the five `db.transaction` call sites to `withTransaction` (savepoints inside a request), gives `createTenant` its own tenant context, and moves QR file cleanup onto `afterCommit` / `afterRollback`. Nothing changes for the user; the QR tests prove the cleanup now follows the real commit.

**Files:**
- Modify: `apps/platform/app/modules/tenancy/services/tenancy_service.ts`
- Modify: `apps/platform/app/modules/tenancy/models/tenant.ts`
- Modify: `apps/platform/app/modules/payments/services/payment_method_service.ts`
- Test: `apps/platform/tests/functional/payments/qr_cleanup.spec.ts` (new), `apps/platform/tests/functional/tenancy/tenancy_service.spec.ts` (one new test)

**Interfaces:**
- Consumes: Task 1 (`withTransaction`, `withDbContext`, `afterCommit`, `afterRollback`, `dbClient`).
- Produces: `TenancyService.createTenant(owner, input)` unchanged signature, now safe inside a request transaction and under RLS.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/payments/qr_cleanup.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import { test } from "@japa/runner";
import ImageService from "#modules/media/services/image_service";
import PaymentMethod from "#modules/payments/models/payment_method";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import { withDbContext } from "#services/db_context";
import { testImages, uploadOf } from "#tests/helpers/images";
import { studioWithOwner } from "#tests/helpers/tenants";

const methods = new PaymentMethodService(new ImageService());
const qr = async () => uploadOf(await testImages.png());
const exists = (key: string) => drive.use("public").exists(key);

test.group("QR file cleanup follows the real commit", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a QR replaced in a transaction that later fails keeps the old file and drops the new one", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const method = await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			qr: await qr(),
		});
		const oldKey = method.qrImageKey ?? "";
		let newKey = "";

		await assert.rejects(
			() =>
				withDbContext({ tenantId: tenant.id }, async () => {
					const saved = await methods.update(tenant, method, {
						label: "Fonepay",
						qr: await qr(),
					});
					newKey = saved.qrImageKey ?? "";
					assert.notEqual(newKey, oldKey);
					assert.isTrue(await exists(oldKey), "old file is not deleted yet");
					throw new Error("later failure");
				}),
			"later failure",
		);

		assert.isTrue(await exists(oldKey));
		assert.isFalse(await exists(newKey));
		const row = await PaymentMethod.findOrFail(method.id);
		assert.equal(row.qrImageKey, oldKey);
	});

	test("the replaced file goes only after the outer transaction commits", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const method = await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			qr: await qr(),
		});
		const oldKey = method.qrImageKey ?? "";

		await withDbContext({ tenantId: tenant.id }, async () => {
			await methods.update(tenant, method, { label: "Fonepay", qr: await qr() });
			assert.isTrue(await exists(oldKey));
		});

		assert.isFalse(await exists(oldKey));
	});

	test("a new QR stored by create is dropped when the surrounding transaction fails", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		let key = "";

		await assert.rejects(
			() =>
				withDbContext({ tenantId: tenant.id }, async () => {
					const method = await methods.create(tenant, {
						kind: "fonepay",
						label: "Fonepay",
						qr: await qr(),
					});
					key = method.qrImageKey ?? "";
					assert.isTrue(await exists(key));
					throw new Error("later failure");
				}),
			"later failure",
		);

		assert.isFalse(await exists(key));
	});
});
```

In `apps/platform/tests/functional/tenancy/tenancy_service.spec.ts`, add imports `import { dbClient, withDbContext } from "#services/db_context";` and `import { artistIn } from ...` only if not already imported, then add this test inside the existing group (use the file's existing `tenancy`, `makeUser` and `studio` helpers, or the equivalents it already has):

```ts
	test("a taken slug leaves the surrounding transaction usable and restores the context", async ({
		assert,
	}) => {
		const first = await makeUser("first@example.com");
		await tenancy.createTenant(first, studio("black-needle"));
		const second = await makeUser("second@example.com");

		await withDbContext({ userId: second.id }, async () => {
			await assert.rejects(
				() => tenancy.createTenant(second, studio("black-needle")),
				SlugTakenError,
			);

			const { rows } = await dbClient().rawQuery(
				"select current_setting('app.tenant_id', true) as tenant_id",
			);
			assert.notOk(rows[0].tenant_id);
		});
	});
```

(If the spec's helper names differ, use whatever it already uses to create a user and a studio input; the assertions are the point.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `PORT=3402 node ace test functional --files=qr_cleanup.spec.ts`
Expected: FAIL. The "old file is not deleted yet" assertion fails, because `update` deletes the old file as soon as its own savepoint returns.

- [ ] **Step 3: Move the services to `withTransaction`**

In `apps/platform/app/modules/payments/services/payment_method_service.ts`: remove `import db from "@adonisjs/lucid/services/db";`, add

```ts
import {
	afterCommit,
	afterRollback,
	withTransaction,
} from "#services/db_context";
```

Replace the body of `create` after `assertRules(...)`:

```ts
		const qr = input.qr
			? await this.images.store(input.qr, { tenant, purpose: QR })
			: undefined;
		return withTransaction(async (trx) => {
			// The file is already stored. If this level rolls back, or the
			// request fails later, no row will point at it.
			if (qr) afterRollback(() => this.images.delete(QR, qr.key));
			const last = await trx
				.from("payment_methods")
				.where("tenant_id", tenant.id)
				.whereNull("deleted_at")
				.max("position as max")
				.first();
			return PaymentMethod.create(
				{
					tenantId: tenant.id,
					kind: input.kind,
					label: input.label,
					...details,
					showOnDepositPage,
					qrImageKey: qr?.key ?? null,
					// The first method gets 0. Ties from two adds at once are
					// harmless: move() renumbers.
					position: (last?.max ?? -1) + 1,
				},
				{ client: trx },
			);
		});
```

Replace the body of `update` after the first `assertRules(...)` (the "fail fast" one):

```ts
		const qr = input.qr
			? await this.images.store(input.qr, { tenant, purpose: QR })
			: undefined;
		return withTransaction(async (trx) => {
			// The file is already stored. If this level rolls back, or the
			// request fails later, no row will point at it.
			if (qr) afterRollback(() => this.images.delete(QR, qr.key));
			// Lock the live row first: a delete that landed since the form
			// loaded makes this a 404, and a QR changed by another edit is
			// read from the row, not from the form's copy.
			const live = await PaymentMethod.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("id", method.id)
				.forUpdate()
				.firstOrFail();
			const previous = live.qrImageKey;
			const keepsQr = !!previous && !input.qr && !input.removeQr;
			assertRules({
				kind: live.kind,
				...details,
				hasQr: !!input.qr || keepsQr,
				showOnDepositPage,
			});
			const next = qr?.key ?? (keepsQr ? previous : null);
			live.merge({
				label: input.label,
				...details,
				showOnDepositPage,
				qrImageKey: next,
			});
			await live.save();
			// The replaced file goes only once the change is committed for good.
			if (previous && previous !== next) {
				afterCommit(() => this.images.delete(QR, previous));
			}
			return live;
		});
```

In `move`, replace `await db.transaction(async (trx) => {` with `await withTransaction(async (trx) => {` (body unchanged).

Update the doc comment above `update`: "The old file is deleted once the row is saved." becomes "The old file is deleted once the outermost transaction commits."

In `apps/platform/app/modules/tenancy/models/tenant.ts`: remove `import db from "@adonisjs/lucid/services/db";`, add `import { withTransaction } from "#services/db_context";`, and change `else await db.transaction(run);` to `else await withTransaction(run);`.

In `apps/platform/app/modules/tenancy/services/tenancy_service.ts`: remove `import db from "@adonisjs/lucid/services/db";`, add `import { dbClient, withDbContext } from "#services/db_context";`, and replace `createTenant`'s `try` body:

```ts
	async createTenant(owner: User, input: NewTenant): Promise<Tenant> {
		try {
			// The id comes first so the inserts run in the new tenant's context:
			// row-level security only lets a tenant row in for its own id.
			const { rows } = await dbClient().rawQuery("select uuidv7() as id");
			const id: string = rows[0].id;
			return await withDbContext({ tenantId: id }, async (trx) => {
				const tenant = await Tenant.create({ id, ...input }, { client: trx });
				await TenantMembership.create(
					{ tenantId: tenant.id, userId: owner.id, role: "owner" },
					{ client: trx },
				);
				return tenant;
			});
		} catch (error) {
```

(keep the existing `catch` block unchanged).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 node ace test functional --files=qr_cleanup.spec.ts` then `PORT=3402 node ace test functional --files=tenancy_service.spec.ts` then `PORT=3402 node ace test functional --files=payment_method`
Expected: PASS everywhere. If `Tenant.create({ id, ... })` ignores the id (the created tenant's id differs from the generated one), set it explicitly with `const tenant = new Tenant(); tenant.merge({ ...input }); tenant.id = id; await tenant.useTransaction(trx).save();` and rerun.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck`
Expected: no errors (an unused `db` import or `TransactionClientContract` import is the likely failure).

```bash
git add apps/platform/app apps/platform/tests
git commit -m "refactor(platform): run services in the request transaction"
```

---

### Task 4: `TenantJob` and the real-worker test helper

Jobs get the same context as requests. The worker swallows a job's error inside the callback an `executionWrapper` would receive, so the transaction lives inside `execute()` instead (spec decisions table).

**Files:**
- Create: `apps/platform/app/services/tenant_job.ts`
- Create: `apps/platform/tests/helpers/worker.ts`
- Create: `apps/platform/tests/helpers/jobs.ts` (the class guard)
- Modify: `apps/platform/tests/helpers/tenants.ts` (add `inTenant`)
- Modify: `docs/superpowers/specs/2026-10-09-tat-28-29-rls-and-isolation-harness-design.md` (the `TenantJob` path)
- Test: `apps/platform/tests/functional/queue/tenant_job.spec.ts`, `apps/platform/tests/unit/jobs/job_classes.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`withDbContext`, `afterCommit`), `Job` from `@adonisjs/queue`, `dispatchInTransaction` from `#services/queue`.
- Produces:
  - `abstract class TenantJob<Payload extends { tenantId: string }> extends Job<Payload>` with `protected abstract handle(): Promise<void>`; subclasses implement `handle()`, never `execute()`.
  - `inTenant<T>(tenant: { id: string }, fn: () => Promise<T>): Promise<T>` in `#tests/helpers/tenants`.
  - `processQueued(queues?: string[]): Promise<void>` and `registerJob(JobClass)` in `#tests/helpers/worker`.
  - `jobsOutsideTenantScope(classes, allowlist): string[]` in `#tests/helpers/jobs`.

- [ ] **Step 1: Add `inTenant` and the worker helper**

In `apps/platform/tests/helpers/tenants.ts`, add the import and the helper:

```ts
import { withDbContext } from "#services/db_context";
```

```ts
/**
 * Runs `fn` in `tenant`'s context, so row-level security lets its rows
 * through. Use it for any direct model read or write in a test.
 */
export function inTenant<T>(tenant: { id: string }, fn: () => Promise<T>) {
	return withDbContext({ tenantId: tenant.id }, () => fn());
}
```

Create `apps/platform/tests/helpers/worker.ts`:

```ts
import app from "@adonisjs/core/services/app";
import db from "@adonisjs/lucid/services/db";
import { Locator, QueueManager, Worker } from "@boringnode/queue";
import { knex } from "@boringnode/queue/drivers/knex_adapter";

type QueueConfig = Record<string, any>;

/**
 * Same as @adonisjs/queue's resolveAdapters, which the package does not
 * export: config entries are factories or objects with a resolver.
 */
async function resolveAdapters(config: QueueConfig) {
	const adapters: Record<string, unknown> = {};
	for (const [name, adapter] of Object.entries<any>(config.adapters)) {
		adapters[name] =
			typeof adapter === "function" ? adapter : await adapter.resolver(app);
	}
	return adapters;
}

/**
 * Makes a job class defined in a test findable by the worker.
 */
export function registerJob(JobClass: { name: string; options?: { name?: string } }) {
	Locator.register(JobClass.options?.name ?? JobClass.name, JobClass as never);
}

/**
 * Runs the real queue Worker until the queue is idle, so a test sees what
 * production does: the worker catches a job's error, retries, and
 * acknowledges the job only after execute() returns.
 *
 * The worker reads and acknowledges rows on the test's own transaction, so
 * it sees jobs the test queued inside it. Starting a worker re-initializes
 * the process-wide QueueManager, so the app's own queue state is put back
 * afterwards for the tests that follow.
 */
export async function processQueued(queues: string[] = ["default"]) {
	const config = app.config.get("queue") as QueueConfig;
	const logger = await app.container.make("logger");
	const base = {
		...config,
		autoLoadJobs: false,
		jobFactory: (jobClass: new () => unknown) => app.container.make(jobClass),
		logger: config.logger ?? logger,
	};
	const worker = new Worker({
		...base,
		// One job at a time and no signal handlers: a test drains the queue and
		// must not leave process listeners behind.
		worker: { ...config.worker, concurrency: 1, gracefulShutdown: false },
		adapters: { database: knex(db.connection().knexClient) },
	} as never);

	try {
		let cycle = await worker.processCycle(queues);
		while (cycle && cycle.type !== "idle") {
			cycle = await worker.processCycle(queues);
		}
		await worker.stop();
	} finally {
		await QueueManager.init({
			...base,
			adapters: await resolveAdapters(config),
		} as never);
	}
}
```

- [ ] **Step 2: Write the failing job tests**

Create `apps/platform/tests/functional/queue/tenant_job.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import type { JobOptions } from "@adonisjs/queue/types";
import { test } from "@japa/runner";
import PaymentMethod from "#modules/payments/models/payment_method";
import { afterCommit, dbClient } from "#services/db_context";
import { dispatchInTransaction } from "#services/queue";
import TenantJob from "#services/tenant_job";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { processQueued, registerJob } from "#tests/helpers/worker";

type Payload = { tenantId: string; label: string; fail?: boolean };

const seen: { tenant: string | null; before: number }[] = [];
const atCommit: boolean[] = [];

async function queueRowExists(jobId: string) {
	return Boolean(await db.from("queue_jobs").where("id", jobId).first());
}

class WriteJob extends TenantJob<Payload> {
	// No retries: a failure is final, so draining the queue is deterministic
	// (the global config retries after a 5 s backoff). Two failing jobs stand
	// in for two attempts in the rollback test.
	static options: JobOptions = { retry: { maxRetries: 0 } };

	protected async handle() {
		const { label, tenantId, fail } = this.payload;
		const { rows } = await dbClient().rawQuery(
			"select current_setting('app.tenant_id', true) as tenant_id",
		);
		const before = await PaymentMethod.query().where("label", label).count("* as n");
		seen.push({ tenant: rows[0].tenant_id || null, before: Number(before[0].$extras.n) });

		await PaymentMethod.create({
			tenantId,
			kind: "cash",
			label,
			position: 0,
		});
		if (fail) throw new Error("boom");

		const { jobId } = this.context;
		afterCommit(async () => {
			atCommit.push(await queueRowExists(jobId));
		});
	}
}

const trx = () => db.connection() as TransactionClientContract;
const labelCount = (tenant: { id: string }, label: string) =>
	inTenant(tenant, async () => {
		const rows = await PaymentMethod.query().where("label", label).count("* as n");
		return Number(rows[0].$extras.n);
	});

test.group("TenantJob", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => {
		seen.length = 0;
		atCommit.length = 0;
		registerJob(WriteJob);
	});

	test("runs the handler in the payload's tenant context and commits", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { jobId } = await dispatchInTransaction(
			WriteJob.dispatch({ tenantId: tenant.id, label: "from job" }),
			trx(),
		);

		await processQueued();

		assert.deepEqual(seen, [{ tenant: tenant.id, before: 0 }]);
		assert.equal(await labelCount(tenant, "from job"), 1);
		assert.isFalse(await queueRowExists(jobId));
	});

	test("a job that writes and then throws leaves nothing behind for the next attempt", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		for (let attempt = 0; attempt < 2; attempt++) {
			await dispatchInTransaction(
				WriteJob.dispatch({ tenantId: tenant.id, label: "doomed", fail: true }),
				trx(),
			);
		}

		await processQueued();

		assert.lengthOf(seen, 2);
		assert.deepEqual(
			seen.map(({ before }) => before),
			[0, 0],
			"the second run did not see the first run's write",
		);
		assert.equal(await labelCount(tenant, "doomed"), 0);
	});

	test("the job is acknowledged only after its writes commit", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { jobId } = await dispatchInTransaction(
			WriteJob.dispatch({ tenantId: tenant.id, label: "ack order" }),
			trx(),
		);

		await processQueued();

		assert.deepEqual(atCommit, [true], "the queue row still existed at commit");
		assert.isFalse(await queueRowExists(jobId));
	});

	test("context does not leak into the next job", async ({ assert }) => {
		const { tenant: first } = await studioWithOwner("first-shop", "First Shop");
		const { tenant: second } = await studioWithOwner("second-shop", "Second Shop");
		await dispatchInTransaction(
			WriteJob.dispatch({ tenantId: first.id, label: "one" }),
			trx(),
		);
		await dispatchInTransaction(
			WriteJob.dispatch({ tenantId: second.id, label: "two" }),
			trx(),
		);

		await processQueued();

		assert.sameMembers(
			seen.map(({ tenant }) => tenant),
			[first.id, second.id],
		);
		assert.equal(await labelCount(first, "one"), 1);
		assert.equal(await labelCount(second, "two"), 1);
	});

	test("a malformed tenantId fails the job before the handler runs", async ({
		assert,
	}) => {
		await dispatchInTransaction(
			WriteJob.dispatch({ tenantId: "not-a-uuid", label: "never" }),
			trx(),
		);

		await processQueued();

		assert.lengthOf(seen, 0);
	});
});
```

Create `apps/platform/tests/helpers/jobs.ts`:

```ts
import TenantJob from "#services/tenant_job";

/**
 * Names of job classes that neither extend TenantJob nor appear in the
 * allowlist (name → why it may run without a tenant).
 */
export function jobsOutsideTenantScope(
	classes: { name: string; prototype: object }[],
	allowlist: Record<string, string>,
): string[] {
	return classes
		.filter(
			(JobClass) =>
				!(JobClass.prototype instanceof TenantJob) &&
				!(JobClass.name in allowlist),
		)
		.map(({ name }) => name);
}
```

Create `apps/platform/tests/unit/jobs/job_classes.spec.ts`:

```ts
import { glob } from "node:fs/promises";
import app from "@adonisjs/core/services/app";
import { Job } from "@adonisjs/queue";
import { test } from "@japa/runner";
import { jobsOutsideTenantScope } from "#tests/helpers/jobs";

/**
 * Jobs allowed to run with no tenant, and why. Anything else that touches
 * tenant data must extend TenantJob (app/services/tenant_job.ts).
 */
const ALLOWLIST = {
	SendMailJob: "sends one email; reads and writes no tenant table",
};

async function jobClasses() {
	const classes: { name: string; prototype: object }[] = [];
	for (const pattern of ["app/jobs/**/*.ts", "app/modules/*/jobs/**/*.ts"]) {
		for await (const file of glob(pattern, { cwd: app.makePath() })) {
			const module = await import(app.makeURL(file).href);
			if (typeof module.default === "function") classes.push(module.default);
		}
	}
	return classes;
}

test.group("Job classes", () => {
	test("every job extends TenantJob or is allowlisted", async ({ assert }) => {
		const classes = await jobClasses();
		assert.isNotEmpty(classes);
		assert.deepEqual(jobsOutsideTenantScope(classes, ALLOWLIST), []);
	});

	test("the guard flags a plain job that is not allowlisted", ({ assert }) => {
		class StrayJob extends Job<{ label: string }> {
			async execute() {}
		}
		assert.deepEqual(jobsOutsideTenantScope([StrayJob], ALLOWLIST), [
			"StrayJob",
		]);
	});
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `PORT=3402 node ace test functional --files=tenant_job.spec.ts`
Expected: FAIL, cannot resolve `#services/tenant_job`.

- [ ] **Step 4: Write `TenantJob`**

Create `apps/platform/app/services/tenant_job.ts`:

```ts
import { Job } from "@adonisjs/queue";
import { withDbContext } from "#services/db_context";

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Base class for jobs that touch tenant-owned data. The payload carries
 * `tenantId` (the TAT-7 convention); `execute()` runs the subclass's
 * `handle()` in that tenant's context and in one transaction, so a throw
 * rolls every write back before the worker retries or fails the job, and
 * the worker acknowledges the job only after the commit.
 *
 * Why a base class and not `executionWrapper` in config/queue.ts: the
 * worker catches a job's error inside the callback a wrapper receives, so
 * a wrapper cannot see a failure, and the worker acknowledges the job
 * before a wrapper could commit.
 *
 * Lives here, not in app/jobs: the worker registers the default export of
 * every file in the jobs folders as a job.
 */
export default abstract class TenantJob<
	Payload extends { tenantId: string },
> extends Job<Payload> {
	async execute(): Promise<void> {
		const tenantId: unknown = this.payload?.tenantId;
		if (typeof tenantId !== "string" || !UUID.test(tenantId)) {
			throw new Error("A TenantJob payload needs a valid tenantId");
		}
		await withDbContext({ tenantId }, () => this.handle());
	}

	protected abstract handle(): Promise<void>;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `PORT=3402 node ace test functional --files=tenant_job.spec.ts` then `PORT=3402 node ace test unit --files=job_classes.spec.ts`
Expected: PASS. If `processQueued` throws while constructing the `Worker` or the restore `QueueManager.init`, read the error: the config shape is the one `node ace queue:work` builds (`node_modules/@adonisjs/queue/build/commands/queue_work.js`); mirror it exactly. Then run the whole functional suite (`PORT=3402 node ace test functional`) to confirm the queue tests that follow still pass, which proves the restore works.

- [ ] **Step 6: Amend the spec for the new path**

In `docs/superpowers/specs/2026-10-09-tat-28-29-rls-and-isolation-harness-design.md`:
- In the *Jobs* section replace "Instead, `app/jobs/tenant_job.ts` (`#jobs/tenant_job`) defines `TenantJob`," with "Instead, `app/services/tenant_job.ts` (`#services/tenant_job`) defines `TenantJob` (not in `app/jobs`, because the worker registers the default export of every file in the jobs folders as a job),".
- In *Changes outside the new code* replace "New `app/jobs/tenant_job.ts` with `TenantJob`." with "New `app/services/tenant_job.ts` with `TenantJob`."

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm typecheck`

```bash
git add apps/platform docs/superpowers/specs
git commit -m "feat(platform): add TenantJob and a real-worker test helper"
```

---

### Task 5: Roles, connections and the boot guard

Splits the database identity in two (owner for migrations, restricted app role for everything else) and refuses to start if the app role could bypass RLS. Policies are not enabled yet, so the whole suite still passes at the end, now as the app role.

**Files:**
- Create: `apps/platform/database/setup_roles.sql`, `apps/platform/app/services/db_role_guard.ts`, `docker/postgres/init/10-setup-roles.sh`
- Modify: `apps/platform/config/database.ts`, `apps/platform/start/env.ts`, `apps/platform/.env.example`, `apps/platform/package.json`, `apps/platform/providers/db_context_provider.ts`, `docker-compose.yml`, `.github/workflows/ci.yml`
- Modify (local only, not committed): `apps/platform/.env`
- Test: `apps/platform/tests/functional/rls/setup_roles.spec.ts`, `apps/platform/tests/functional/rls/role_guard.spec.ts`; one assertion added to `db_context.spec.ts`

**Interfaces:**
- Consumes: Task 1 provider.
- Produces:
  - Lucid connection `owner` (owner credentials, same `migrations` and `schemaGeneration` settings as `pg`).
  - Env: `DB_MIGRATION_USER` (string), `DB_MIGRATION_PASSWORD` (optional string).
  - `assertRestrictedDbRole(client: QueryClientContract): Promise<void>` from `#services/db_role_guard`; throws naming the reasons.
  - `pnpm migrate`, `pnpm migrate:rollback` in `apps/platform`.
  - `setup_roles.sql` psql variables: `app_user`, `app_password`, `owner_user`.

- [ ] **Step 1: Add the `owner` connection and the env variables**

In `apps/platform/start/env.ts`, after `DB_PASSWORD`:

```ts
	DB_USER: Env.schema.string(),
	DB_PASSWORD: Env.schema.string.optional(),
	DB_MIGRATION_USER: Env.schema.string(),
	DB_MIGRATION_PASSWORD: Env.schema.string.optional(),
```

In `apps/platform/.env.example` replace the database block:

```
# Database (defaults match the root docker-compose.yml)
# DB_USER is the restricted app role that database/setup_roles.sql creates.
# DB_MIGRATION_USER owns the tables and runs migrations (pnpm migrate).
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=tattoo_drip_app
DB_PASSWORD=tattoo_drip_app
DB_MIGRATION_USER=postgres
DB_MIGRATION_PASSWORD=postgres
DB_DATABASE=tattoo_drip
```

In `apps/platform/config/database.ts`, add a second connection after `pg` (same `migrations` and `schemaGeneration` blocks):

```ts
		/**
		 * The owner role: owns the tables and runs migrations (pnpm migrate).
		 * Never the default connection, or RLS would silently not apply.
		 */
		owner: {
			client: "pg",
			connection: {
				host: env.get("DB_HOST"),
				port: env.get("DB_PORT"),
				user: env.get("DB_MIGRATION_USER"),
				password: env.get("DB_MIGRATION_PASSWORD"),
				database: env.get("DB_DATABASE"),
			},
			migrations: {
				naturalSort: true,
				paths: ["database/migrations"],
			},
			schemaGeneration: {
				enabled: true,
				rulesPaths: ["./database/schema_rules.js"],
			},
			debug: app.inDev,
		},
```

In `apps/platform/package.json` scripts add:

```json
    "migrate": "node ace migration:run --connection=owner",
    "migrate:rollback": "node ace migration:rollback --connection=owner",
```

- [ ] **Step 2: Write `setup_roles.sql`**

Create `apps/platform/database/setup_roles.sql`:

```sql
-- Creates the restricted app role and grants it what it needs. Run once per
-- database, as the owner (or any role that may create roles), before the
-- first `pnpm migrate`. Safe to run again: it always puts the role back to
-- a login role with no special powers.
--
--   psql -v ON_ERROR_STOP=1 -d tattoo_drip \
--     -v app_user=tattoo_drip_app -v app_password=... -v owner_user=postgres \
--     -f database/setup_roles.sql
--
-- Role creation and grants stay out of migrations: they are infrastructure
-- and need privileges a managed Postgres owner role may not have.

\set ON_ERROR_STOP on

-- The ALTER ROLE below would strip a superuser of its powers.
SELECT :'app_user' = :'owner_user' AS same_role \gset
\if :same_role
  DO $$ BEGIN RAISE EXCEPTION 'app_user and owner_user must be different roles'; END $$;
\endif

SELECT format('CREATE ROLE %I LOGIN', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

ALTER ROLE :"app_user" LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'app_password';

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_user')
\gexec

GRANT USAGE ON SCHEMA public TO :"app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_user";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_user";

-- Tables and sequences the owner creates later (every migration) are granted too.
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_user" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_user" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";
```

- [ ] **Step 3: Write the failing script and guard tests**

Create `apps/platform/tests/functional/rls/setup_roles.spec.ts`:

```ts
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
			"-v", "ON_ERROR_STOP=1",
			"-h", env.get("DB_HOST"),
			"-p", String(env.get("DB_PORT")),
			"-U", env.get("DB_MIGRATION_USER"),
			"-d", env.get("DB_DATABASE"),
			"-v", `app_user=${appUser}`,
			"-v", "app_password=probe-password",
			"-v", `owner_user=${ownerUser}`,
			"-f", app.makePath("database/setup_roles.sql"),
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
```

Create `apps/platform/tests/functional/rls/role_guard.spec.ts`:

```ts
import db from "@adonisjs/lucid/services/db";
import { test } from "@japa/runner";
import { assertRestrictedDbRole } from "#services/db_role_guard";

const owner = () => db.connection("owner");
const PROBES = [
	"td_probe_member",
	"td_probe_owner",
	"td_probe_bypass",
];

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

	test("accepts the app connection", async () => {
		await assertRestrictedDbRole(db.connection());
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
		await owner().rawQuery("alter table td_probe_table owner to td_probe_owner");
		await assert.rejects(() => guardAs("td_probe_owner"), /owns a table/);
	});

	test("rejects a member of a role that owns a table", async ({ assert }) => {
		await owner().rawQuery("create role td_probe_owner nologin");
		await owner().rawQuery("create table td_probe_table (id int)");
		await owner().rawQuery("alter table td_probe_table owner to td_probe_owner");
		await owner().rawQuery("create role td_probe_member nologin in role td_probe_owner");
		await assert.rejects(() => guardAs("td_probe_member"), /owns a table/);
	});
});
```

Add to the `Model adapter` group in `apps/platform/tests/functional/db_context/db_context.spec.ts`:

```ts
	test("a model on another connection keeps its own client", async ({
		assert,
	}) => {
		await withDbContext({}, async (trx) => {
			const other = BaseModel.$adapter.modelConstructorClient(Tenant, {
				connection: "owner",
			});
			assert.notStrictEqual(other, trx);
			assert.equal(other.connectionName, "owner");
		});
	});
```

- [ ] **Step 4: Switch your local environment (not committed)**

Edit `apps/platform/.env` to match the new `.env.example` database block (`DB_USER=tattoo_drip_app`, `DB_PASSWORD=tattoo_drip_app`, `DB_MIGRATION_USER=postgres`, `DB_MIGRATION_PASSWORD=postgres`). Then create the role in your dev database (Postgres must be running; `pnpm podman:up -d` starts it):

```bash
cd apps/platform
PGPASSWORD=postgres psql -h 127.0.0.1 -p 5432 -U postgres -d tattoo_drip \
  -v ON_ERROR_STOP=1 -v app_user=tattoo_drip_app -v app_password=tattoo_drip_app -v owner_user=postgres \
  -f database/setup_roles.sql
```

Expected: no errors; `\du` in psql lists `tattoo_drip_app` without Superuser.

- [ ] **Step 5: Run the new tests to verify they fail**

Run: `PORT=3402 node ace test functional --files=role_guard.spec.ts`
Expected: FAIL, cannot resolve `#services/db_role_guard`. (`setup_roles.spec` should already PASS; it only needs the script and the `owner` connection.)

- [ ] **Step 6: Write the guard and wire it into the boot**

Create `apps/platform/app/services/db_role_guard.ts`:

```ts
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
		problems.push(
			"owns a table in public, or is a member of a role that does",
		);
	}
	if (problems.length > 0) {
		throw new Error(
			`Database role "${role.rolname}" ${problems.join(" and ")}, so row-level security would not protect tenant data. Set DB_USER to the restricted app role (see database/setup_roles.sql).`,
		);
	}
}
```

In `apps/platform/providers/db_context_provider.ts` add the import `import { assertRestrictedDbRole } from "#services/db_role_guard";` and a `ready()` method to `DbContextProvider`:

```ts
	/**
	 * Refuses to serve, work or test as a role that bypasses RLS. Other ace
	 * commands (codegen, build, migrations) skip it: migrations run as the
	 * owner on purpose.
	 */
	async ready() {
		const environment = this.app.getEnvironment();
		const isWorker =
			environment === "console" && process.argv.includes("queue:work");
		if (environment !== "web" && environment !== "test" && !isWorker) return;

		const db = await this.app.container.make("lucid.db");
		await assertRestrictedDbRole(db.connection());
	}
```

- [ ] **Step 7: Run the whole functional suite as the app role**

Run: `PORT=3402 node ace test functional`
Expected: all PASS, now connected as `tattoo_drip_app`. (Policies are not enabled yet, so only grants matter.)

Check the guard refuses the owner: `DB_USER=postgres DB_PASSWORD=postgres PORT=3402 node ace test unit --files=job_classes.spec.ts`
Expected: FAIL at startup with `Database role "postgres" is a superuser`. Check the worker path the same way: `DB_USER=postgres DB_PASSWORD=postgres timeout 20 node ace queue:work`
Expected: exits within seconds with the same message (the guard recognizes `queue:work`). Confirm migrations still work: `pnpm migrate` prints `Already up to date`.

- [ ] **Step 8: Compose, CI and the init script**

Create `docker/postgres/init/10-setup-roles.sh`:

```sh
#!/bin/sh
# Runs once, when Postgres initializes an empty data volume: creates the
# restricted app role (see apps/platform/database/setup_roles.sql).
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_user="$APP_DB_USER" \
  -v app_password="$APP_DB_PASSWORD" \
  -v owner_user="$POSTGRES_USER" \
  -f /opt/setup_roles.sql
```

In `docker-compose.yml`, change the `postgres` service:

```yaml
    environment:
      # The cluster is bootstrapped by the owner. The app role is created by
      # the init script, from DB_USER and DB_PASSWORD.
      POSTGRES_USER: ${DB_MIGRATION_USER:-postgres}
      POSTGRES_PASSWORD: ${DB_MIGRATION_PASSWORD:-postgres}
      POSTGRES_DB: ${DB_DATABASE:-tattoo_drip}
      APP_DB_USER: ${DB_USER:-tattoo_drip_app}
      APP_DB_PASSWORD: ${DB_PASSWORD:-tattoo_drip_app}
    ports:
      - "${DB_PORT:-5432}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro
      - ./apps/platform/database/setup_roles.sql:/opt/setup_roles.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_MIGRATION_USER:-postgres} -d ${DB_DATABASE:-tattoo_drip}"]
```

In `.github/workflows/ci.yml`, add a step before `Run migrations` and change the migrations command:

```yaml
      # The app connects as a restricted role; migrations run as the owner.
      - name: Create the app database role
        working-directory: apps/platform
        env:
          PGPASSWORD: postgres
        run: |
          psql -h 127.0.0.1 -U postgres -d tattoo_drip -v ON_ERROR_STOP=1 \
            -v app_user=tattoo_drip_app -v app_password=tattoo_drip_app -v owner_user=postgres \
            -f database/setup_roles.sql

      # Applies every migration to Postgres 18. The generator rewrites
      # database/schema.ts, so fail if that differs from the committed file.
      - name: Run migrations
        working-directory: apps/platform
        run: pnpm migrate
```

- [ ] **Step 9: Verify the compose bootstrap on an empty volume, without touching your dev data**

```bash
cd /home/blank/Coding/tattoo-drip
DB_PORT=55432 PODMAN_COMPOSE_PROVIDER=podman-compose podman compose -p rlscheck --env-file apps/platform/.env up -d postgres
sleep 15
podman ps --filter name=rlscheck --format '{{.Names}} {{.Status}}'
```

Expected: one `rlscheck…postgres…` container, status `Up … (healthy)`.

```bash
podman exec "$(podman ps --filter name=rlscheck --format '{{.Names}}' | head -1)" \
  psql -U postgres -d tattoo_drip -c '\du'
```

Expected: `postgres` has `Superuser`; `tattoo_drip_app` does not.

```bash
cd apps/platform
DB_PORT=55432 pnpm migrate
DB_PORT=55432 PORT=3402 node ace test functional --files=role_guard.spec.ts
```

Expected: migrations apply; guard tests PASS on the fresh cluster. Clean up: `cd ../.. && PODMAN_COMPOSE_PROVIDER=podman-compose podman compose -p rlscheck --env-file apps/platform/.env down -v`.

- [ ] **Step 10: Typecheck and commit**

Run: `pnpm typecheck && pnpm --filter @tattoo-drip/platform exec biome check .` (or the root `pnpm check`).

```bash
git add apps/platform docker docker-compose.yml .github/workflows/ci.yml
git commit -m "feat(platform): split owner and app database roles with a boot guard"
```

### Task 6: Slug uniqueness relies on the unique index

Once policies are on, the Vine `.unique({ table: "tenants" })` rule runs a raw query with no context and would silently never find a conflict. The unique index plus the existing `SlugTakenError` path becomes the only check, with one message.

**Files:**
- Modify: `apps/platform/app/modules/tenancy/validators/tenant.ts`, `apps/platform/app/controllers/onboarding_controller.ts`
- Test: `apps/platform/tests/functional/tenancy/onboarding.spec.ts` (existing test `rejects a slug that's already taken`, unchanged)

**Interfaces:**
- Consumes: `SlugTakenError` from `#modules/tenancy/errors`, thrown by `TenancyService.createTenant`.
- Produces: the onboarding form still shows "This address is already taken. Try another one." on the `slug` field.

- [ ] **Step 1: Confirm the baseline passes**

Run: `PORT=3402 node ace test functional --files=onboarding.spec.ts`
Expected: PASS (the validator rule produces the message today).

- [ ] **Step 2: Remove the validator rule and its message**

In `apps/platform/app/modules/tenancy/validators/tenant.ts`, replace the `slug` entry of `createTenantValidator`:

```ts
	// Taken slugs, deleted tenants' included, are rejected by the unique index
	// and surfaced by TenancyService.createTenant as SlugTakenError. A raw
	// `.unique()` query here would only see the user's own tenants once
	// row-level security is on.
	slug: vine.string().trim().toLowerCase().regex(SLUG),
```

and delete the `"slug.database.unique"` line from the `SimpleMessagesProvider` messages (with its "Lucid's unique rule reports as…" comment). Keep `"slug.regex"`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `PORT=3402 node ace test functional --files=onboarding.spec.ts`
Expected: FAIL in `rejects a slug that's already taken`: the field shows "This address was just taken. Try another one." instead of "This address is already taken. Try another one."

- [ ] **Step 4: Use one message in the controller**

In `apps/platform/app/controllers/onboarding_controller.ts`, in `store()` replace the `catch` body's comment and message:

```ts
			// The unique index rejected the slug (a deleted tenant's slug stays
			// reserved), or another signup took it since the form loaded.
			if (error instanceof SlugTakenError) {
				throw new errors.E_VALIDATION_ERROR([
					{
						field: "slug",
						message: "This address is already taken. Try another one.",
						rule: "unique",
					},
				]);
			}
```

- [ ] **Step 5: Run the tests to verify they pass, then commit**

Run: `PORT=3402 node ace test functional --files=onboarding.spec.ts` then `PORT=3402 node ace test functional --files=tenancy_service.spec.ts`
Expected: PASS.

```bash
git add apps/platform
git commit -m "refactor(platform): leave slug uniqueness to the unique index"
```

---

### Task 7: Turn row-level security on

The switch. The app already carries context everywhere (Tasks 1–4) and runs as the restricted role (Task 5), so this task adds the helpers, the policy migration, the tests that prove the policies, and the sweep that moves existing specs into contexts.

**Files:**
- Create: `apps/platform/database/helpers/tenant_rls.ts`
- Create: `apps/platform/database/migrations/1791570000000_enable_row_level_security.ts`
- Modify: `apps/platform/tests/helpers/tenants.ts` (`artistIn`, add `inUser`, `inTenantAs`)
- Modify (the sweep): every spec that fails once the policies are on (see Step 6)
- Test: `apps/platform/tests/unit/database/tenant_rls.spec.ts`, `apps/platform/tests/functional/rls/policies.spec.ts`, `apps/platform/tests/functional/rls/catalog_guard.spec.ts`, `apps/platform/tests/functional/queue/tenant_job.spec.ts` (two tests added)

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:
  - `enableTenantRls(table: string): string[]`, `disableTenantRls(table: string): string[]` — SQL statements a migration runs with `this.schema.raw(…)`. (The spec's "runs ENABLE…" means these statements.)
  - `tenantReference(table, column, parent, onDelete?)` — composite foreign key `(tenant_id, column) → parent(tenant_id, id)` inside a `createTable` / `alterTable` callback.
  - SQL functions `app_tenant_id()`, `app_user_id()`; policies as in the spec's *Policies* table.
  - Test helpers `inUser(user, fn)` and `inTenantAs(tenant, user, fn)` in `#tests/helpers/tenants`.

- [ ] **Step 1: Write the helpers and their unit test**

Create `apps/platform/tests/unit/database/tenant_rls.spec.ts`:

```ts
import db from "@adonisjs/lucid/services/db";
import { test } from "@japa/runner";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

test.group("tenant RLS migration helpers", () => {
	test("enableTenantRls enables RLS, adds the composite-key target and the standard policy", ({
		assert,
	}) => {
		assert.deepEqual(enableTenantRls("quotes"), [
			"alter table quotes enable row level security",
			"alter table quotes add constraint quotes_tenant_id_id_unique unique (tenant_id, id)",
			"create policy tenant_isolation on quotes for all using (tenant_id = (select app_tenant_id())) with check (tenant_id = (select app_tenant_id()))",
		]);
	});

	test("disableTenantRls undoes it in reverse order", ({ assert }) => {
		assert.deepEqual(disableTenantRls("quotes"), [
			"drop policy tenant_isolation on quotes",
			"alter table quotes drop constraint quotes_tenant_id_id_unique",
			"alter table quotes disable row level security",
		]);
	});

	test("tenantReference builds a composite foreign key through tenant_id", ({
		assert,
	}) => {
		const sql = db
			.connection()
			.schema.createTable("probe_child", (table) => {
				table.uuid("id").primary();
				table.uuid("tenant_id").notNullable();
				table.uuid("parent_id").notNullable();
				tenantReference(table, "parent_id", "probe_parent");
			})
			.toQuery();

		assert.match(
			sql,
			/foreign key \("tenant_id", "parent_id"\) references "probe_parent" \("tenant_id", "id"\) on delete CASCADE/i,
		);
	});
});
```

Create `apps/platform/database/helpers/tenant_rls.ts`:

```ts
/**
 * Migration helpers for tenant-owned tables (every table with a tenant_id).
 * A new tenant-owned table's migration runs enableTenantRls() on it; a test
 * (tests/functional/rls/catalog_guard.spec.ts) fails for a table that does
 * not.
 *
 *   for (const sql of enableTenantRls("quotes")) this.schema.raw(sql);
 *
 * The policy reads the context the request or job transaction sets, see
 * app/services/db_context.ts. It has an explicit WITH CHECK so a row can
 * never be moved to another tenant.
 */
export function enableTenantRls(table: string): string[] {
	return [
		`alter table ${table} enable row level security`,
		// The target of other tables' composite foreign keys.
		`alter table ${table} add constraint ${table}_tenant_id_id_unique unique (tenant_id, id)`,
		`create policy tenant_isolation on ${table} for all using (tenant_id = (select app_tenant_id())) with check (tenant_id = (select app_tenant_id()))`,
	];
}

/**
 * The statements for a migration's down().
 */
export function disableTenantRls(table: string): string[] {
	return [
		`drop policy tenant_isolation on ${table}`,
		`alter table ${table} drop constraint ${table}_tenant_id_id_unique`,
		`alter table ${table} disable row level security`,
	];
}

type ForeignKeyBuilder = {
	references(columns: string[]): {
		inTable(table: string): { onDelete(action: string): unknown };
	};
};

/**
 * A reference from one tenant-owned table to another that includes
 * tenant_id, so the database rejects a link between tenants. The parent
 * needs enableTenantRls() first (its UNIQUE (tenant_id, id) is the target).
 *
 *   tenantReference(table, "client_id", "clients");
 */
export function tenantReference(
	table: { foreign(columns: string[]): ForeignKeyBuilder },
	column: string,
	parent: string,
	onDelete = "CASCADE",
) {
	table
		.foreign(["tenant_id", column])
		.references(["tenant_id", "id"])
		.inTable(parent)
		.onDelete(onDelete);
}
```

Run: `PORT=3402 node ace test unit --files=tenant_rls.spec.ts`
Expected: PASS (the helpers are plain functions). If `.toQuery()` quotes differently, adjust only the regex.

- [ ] **Step 2: Write the failing policy tests**

Create `apps/platform/tests/functional/rls/policies.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import {
	type DbContextValues,
	dbClient,
	withDbContext,
	withTransaction,
} from "#services/db_context";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

// Raw SQL only: these tests prove the database enforces isolation even when
// the app's own query code is bypassed.
const sql = (context: DbContextValues, query: string, bindings: unknown[] = []) =>
	withDbContext(context, (trx) => trx.rawQuery(query, bindings));

async function seed() {
	const a = await studioWithOwner("studio-a", "Studio A");
	const b = await studioWithOwner("studio-b", "Studio B");
	for (const { tenant } of [a, b]) {
		await inTenant(tenant, () =>
			dbClient().rawQuery(
				"insert into payment_methods (tenant_id, kind, label, position, created_at) values (?, 'cash', ?, 0, now())",
				[tenant.id, `${tenant.slug} cash`],
			),
		);
	}
	return { a, b };
}

test.group("RLS: tenant context", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("under context A, tenant-owned tables return only A's rows", async ({
		assert,
	}) => {
		const { a, b } = await seed();

		for (const table of ["payment_methods", "tenant_memberships"]) {
			const { rows } = await sql({ tenantId: a.tenant.id }, `select tenant_id from ${table}`);
			assert.isNotEmpty(rows, table);
			assert.isTrue(
				rows.every((row: { tenant_id: string }) => row.tenant_id === a.tenant.id),
				table,
			);
		}
		const { rows } = await sql({ tenantId: a.tenant.id }, "select id from tenants");
		assert.deepEqual(rows.map((row: { id: string }) => row.id), [a.tenant.id]);
		assert.notInclude(rows.map((row: { id: string }) => row.id), b.tenant.id);
	});

	test("with no context nothing comes back while other tenants have data", async ({
		assert,
	}) => {
		await seed();

		for (const table of ["payment_methods", "tenant_memberships", "tenants"]) {
			const { rows } = await dbClient().rawQuery(
				`select count(*)::int as n from ${table}`,
			);
			assert.equal(rows[0].n, 0, table);
		}
	});

	test("an insert for another tenant fails the policy check", async ({
		assert,
	}) => {
		const { a, b } = await seed();

		await withDbContext({ tenantId: a.tenant.id }, async () => {
			await assert.rejects(
				() =>
					withTransaction((trx) =>
						trx.rawQuery(
							"insert into payment_methods (tenant_id, kind, label, position, created_at) values (?, 'cash', 'x', 1, now())",
							[b.tenant.id],
						),
					),
				/row-level security/,
			);
			await assert.rejects(
				() =>
					withTransaction((trx) =>
						trx.rawQuery(
							"insert into tenant_memberships (tenant_id, user_id, role, created_at) values (?, ?, 'owner', now())",
							[b.tenant.id, a.owner.id],
						),
					),
				/row-level security/,
			);
			await assert.rejects(
				() =>
					withTransaction((trx) =>
						trx.rawQuery(
							"insert into tenants (type, name, slug, timezone, created_at) values ('studio', 'x', 'x-shop', 'UTC', now())",
						),
					),
				/row-level security/,
			);
		});
	});

	test("update and delete on another tenant's rows affect zero rows", async ({
		assert,
	}) => {
		const { a, b } = await seed();

		await withDbContext({ tenantId: a.tenant.id }, async (trx) => {
			const update = await trx.rawQuery(
				"update payment_methods set label = 'hacked' where tenant_id = ?",
				[b.tenant.id],
			);
			const remove = await trx.rawQuery(
				"delete from payment_methods where tenant_id = ?",
				[b.tenant.id],
			);
			assert.equal(update.rowCount, 0);
			assert.equal(remove.rowCount, 0);
		});
		const { rows } = await sql(
			{ tenantId: b.tenant.id },
			"select label from payment_methods",
		);
		assert.deepEqual(rows, [{ label: "studio-b cash" }]);
	});

	test("an unqualified UPDATE that moves a row to another tenant fails and changes nothing", async ({
		assert,
	}) => {
		const { a, b } = await seed();
		const moves: [string, string][] = [
			["payment_methods", "tenant_id"],
			["tenant_memberships", "tenant_id"],
			["tenants", "id"],
		];

		for (const [table, column] of moves) {
			await withDbContext({ tenantId: a.tenant.id }, async () => {
				await assert.rejects(
					() =>
						withTransaction((trx) =>
							trx.rawQuery(`update ${table} set ${column} = ?`, [b.tenant.id]),
						),
					/row-level security/,
					`${table}.${column}`,
				);
			});
		}
		const { rows } = await sql(
			{ tenantId: a.tenant.id },
			"select tenant_id from payment_methods",
		);
		assert.deepEqual(rows, [{ tenant_id: a.tenant.id }]);
	});
});

test.group("RLS: user context (listing my studios, resolving a slug)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a user sees their own studios and memberships, and resolves their slug", async ({
		assert,
	}) => {
		const { a, b } = await seed();

		const tenants = await sql({ userId: a.owner.id }, "select slug from tenants");
		assert.deepEqual(tenants.rows, [{ slug: "studio-a" }]);

		const memberships = await sql(
			{ userId: a.owner.id },
			"select user_id from tenant_memberships",
		);
		assert.deepEqual(memberships.rows, [{ user_id: a.owner.id }]);

		const own = await sql({ userId: a.owner.id }, "select id from tenants where slug = ?", ["studio-a"]);
		assert.lengthOf(own.rows, 1);
		const stranger = await sql({ userId: b.owner.id }, "select id from tenants where slug = ?", ["studio-a"]);
		assert.lengthOf(stranger.rows, 0);
	});

	test("a removed member no longer sees the studio", async ({ assert }) => {
		const { a } = await seed();
		await inTenant(a.tenant, () =>
			dbClient().rawQuery(
				"update tenant_memberships set deleted_at = now() where user_id = ?",
				[a.owner.id],
			),
		);

		const { rows } = await sql({ userId: a.owner.id }, "select slug from tenants");
		assert.deepEqual(rows, []);
	});
});
```

Create `apps/platform/tests/functional/rls/catalog_guard.spec.ts`:

```ts
import { test } from "@japa/runner";
import { dbClient } from "#services/db_context";

/**
 * Tables without row-level security, and why. A new table that is neither
 * on this list nor RLS-protected fails the guard: adding to the list is a
 * conscious edit. A table with a tenant_id column can never be listed.
 */
const EXEMPT: Record<string, string> = {
	users: "global identity, read before any context exists (login, session, signup)",
	queue_jobs: "queue storage, not tenant-owned",
	queue_schedules: "queue storage, not tenant-owned",
	adonis_schema: "migration bookkeeping",
	adonis_schema_versions: "migration bookkeeping",
};

/** The exact policies each protected table has, as "name:COMMAND". */
const EXPECTED_POLICIES: Record<string, string[]> = {
	payment_methods: ["tenant_isolation:ALL"],
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

async function rows<T = Record<string, any>>(query: string) {
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
		assert.deepEqual(unprotected, [], "use enableTenantRls() in the migration, or add a reasoned exemption");

		const stale = Object.keys(EXEMPT).filter(
			(name) => !tables.some(({ table_name }) => table_name === name),
		);
		assert.deepEqual(stale, [], "exemptions for tables that no longer exist");
	});

	test("a table with a tenant_id column is never exempt", async ({ assert }) => {
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
		const policies = await rows<{ tablename: string; policyname: string; cmd: string }>(
			"select tablename, policyname, cmd from pg_policies where schemaname = 'public'",
		);
		const actual: Record<string, string[]> = {};
		for (const { tablename, policyname, cmd } of policies) {
			(actual[tablename] ??= []).push(`${policyname}:${cmd}`);
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
		}>("select policyname, cmd, qual, with_check from pg_policies where schemaname = 'public'");

		for (const { policyname, cmd, qual, with_check } of policies) {
			assert.notEqual(qual, "true", `${policyname} USING`);
			assert.notEqual(with_check, "true", `${policyname} WITH CHECK`);
			if (["ALL", "INSERT", "UPDATE"].includes(cmd)) {
				assert.isNotNull(with_check, `${policyname} needs an explicit WITH CHECK`);
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
						unique.table_name === name && unique.def === "UNIQUE (tenant_id, id)",
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
```

Add two job tests to `apps/platform/tests/functional/queue/tenant_job.spec.ts` (they only mean something once policies are on):

```ts
import { Job } from "@adonisjs/queue";
```

```ts
const plainSaw: number[] = [];

class PlainReadJob extends Job<{ label: string }> {
	async execute() {
		const rows = await PaymentMethod.query().where("label", this.payload.label);
		plainSaw.push(rows.length);
	}
}
```

```ts
	test("a TenantJob sees its tenant's rows and not another tenant's", async ({
		assert,
	}) => {
		const { tenant: first } = await studioWithOwner("first-shop", "First Shop");
		const { tenant: second } = await studioWithOwner("second-shop", "Second Shop");
		await inTenant(first, () =>
			PaymentMethod.create({ tenantId: first.id, kind: "cash", label: "shared label", position: 0 }),
		);
		await dispatchInTransaction(
			WriteJob.dispatch({ tenantId: first.id, label: "shared label" }),
			trx(),
		);
		await dispatchInTransaction(
			WriteJob.dispatch({ tenantId: second.id, label: "shared label" }),
			trx(),
		);

		await processQueued();

		const sawBefore = new Map(seen.map(({ tenant, before }) => [tenant, before]));
		assert.equal(sawBefore.get(first.id), 1, "first tenant's job sees its own row");
		assert.equal(sawBefore.get(second.id), 0, "second tenant's job does not see first's");
	});

	test("a plain job outside any tenant sees no tenant rows", async ({ assert }) => {
		plainSaw.length = 0;
		registerJob(PlainReadJob);
		const { tenant } = await studioWithOwner();
		await inTenant(tenant, () =>
			PaymentMethod.create({ tenantId: tenant.id, kind: "cash", label: "invisible", position: 0 }),
		);
		await dispatchInTransaction(PlainReadJob.dispatch({ label: "invisible" }), trx());

		await processQueued();

		assert.deepEqual(plainSaw, [0]);
	});
```

(In this spec `seen` runs in order, so the first job processed may not be `first`; the Map keyed by tenant makes the assertion order-independent.)

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `PORT=3402 node ace test functional --files=policies.spec.ts` and `PORT=3402 node ace test functional --files=catalog_guard.spec.ts`
Expected: FAIL. With no policies, "no context" returns rows, inserts for other tenants succeed, and the catalog guard reports `payment_methods`, `tenant_memberships` and `tenants` as unprotected.

- [ ] **Step 4: Write the migration**

Create `apps/platform/database/migrations/1791570000000_enable_row_level_security.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
} from "#database/helpers/tenant_rls";

const TENANT = "(select app_tenant_id())";
const USER = "(select app_user_id())";

/**
 * Row-level security (TAT-28). The app role reads the context a request or
 * job transaction sets (app/services/db_context.ts); with no context every
 * comparison is NULL and no row comes back.
 *
 * RLS is ENABLEd, not FORCEd: the owner keeps bypassing it, so data
 * migrations behave the same everywhere. The boot guard makes sure the app
 * role is never the owner.
 */
export default class extends BaseSchema {
	async up() {
		const statements = [
			`create function app_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$`,
			`create function app_user_id() returns uuid language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$`,

			...enableTenantRls("payment_methods"),

			// A membership is visible inside its tenant, and to its own user
			// (listing "my studios"). Writes need the tenant context.
			"alter table tenant_memberships enable row level security",
			"alter table tenant_memberships add constraint tenant_memberships_tenant_id_id_unique unique (tenant_id, id)",
			`create policy tenant_memberships_select on tenant_memberships for select using (tenant_id = ${TENANT} or user_id = ${USER})`,
			`create policy tenant_memberships_insert on tenant_memberships for insert with check (tenant_id = ${TENANT})`,
			`create policy tenant_memberships_update on tenant_memberships for update using (tenant_id = ${TENANT}) with check (tenant_id = ${TENANT})`,
			`create policy tenant_memberships_delete on tenant_memberships for delete using (tenant_id = ${TENANT})`,

			// A tenant is visible when it is the current one, or when the user
			// has a live membership in it (resolving a slug, listing studios).
			// No delete policy: tenants are soft-deleted. Any signed-in user
			// can create a tenant by setting its new id as context; onboarding
			// stays the gate.
			"alter table tenants enable row level security",
			`create policy tenants_select on tenants for select using (id = ${TENANT} or id in (select tenant_id from tenant_memberships where user_id = ${USER} and deleted_at is null))`,
			`create policy tenants_insert on tenants for insert with check (id = ${TENANT})`,
			`create policy tenants_update on tenants for update using (id = ${TENANT}) with check (id = ${TENANT})`,
		];
		for (const statement of statements) this.schema.raw(statement);
	}

	async down() {
		const statements = [
			"drop policy tenants_update on tenants",
			"drop policy tenants_insert on tenants",
			"drop policy tenants_select on tenants",
			"alter table tenants disable row level security",

			"drop policy tenant_memberships_delete on tenant_memberships",
			"drop policy tenant_memberships_update on tenant_memberships",
			"drop policy tenant_memberships_insert on tenant_memberships",
			"drop policy tenant_memberships_select on tenant_memberships",
			"alter table tenant_memberships drop constraint tenant_memberships_tenant_id_id_unique",
			"alter table tenant_memberships disable row level security",

			...disableTenantRls("payment_methods"),

			"drop function app_user_id()",
			"drop function app_tenant_id()",
		];
		for (const statement of statements) this.schema.raw(statement);
	}
}
```

Run (from `apps/platform`): `pnpm migrate`
Expected: the migration runs; `database/schema.ts` is regenerated. Then `pnpm exec biome check --write database/schema.ts && git diff --stat database/schema.ts` should show no change (policies and constraints do not alter the generated model classes). If it does change, include it.

- [ ] **Step 5: Run the policy tests to verify they pass**

Run: `PORT=3402 node ace test functional --files=policies.spec.ts`, then `--files=catalog_guard.spec.ts`, then `PORT=3402 node ace test unit --files=tenant_rls.spec.ts`
Expected: PASS. If the "moves a row" test reports a unique-violation error instead of `row-level security` for `tenants.id`, the check order differs on this Postgres version: assert `/row-level security|duplicate key/` for that table only and note it in the commit message.

- [ ] **Step 6: Update the tenant helpers, then sweep the specs the policies broke**

In `apps/platform/tests/helpers/tenants.ts`, make `artistIn` create its membership in the tenant's context and add two helpers:

```ts
export async function artistIn(tenant: Tenant, email = "artist@example.com") {
	const user = await User.create({ email, password: "secret-password" });
	await inTenant(tenant, () =>
		TenantMembership.create({
			tenantId: tenant.id,
			userId: user.id,
			role: "artist",
		}),
	);
	return user;
}

/**
 * Runs `fn` as `user` with no tenant: what a signed-in user sees on
 * /dashboard (their own studios and memberships).
 */
export function inUser<T>(user: { id: string }, fn: () => Promise<T>) {
	return withDbContext({ userId: user.id }, () => fn());
}

/**
 * Runs `fn` as `user` inside `tenant`: what a member sees on a tenant page.
 */
export function inTenantAs<T>(
	tenant: { id: string },
	user: { id: string },
	fn: () => Promise<T>,
) {
	return withDbContext({ tenantId: tenant.id, userId: user.id }, () => fn());
}
```

Run the whole suite and list what broke: `PORT=3402 node ace test functional 2>&1 | tail -n 150`
Expected: failures in the specs that touch `Tenant`, `TenantMembership` or `PaymentMethod` directly: `auth/access`, `models/soft_deletes`, the three `payments/*`, the four `tenancy/*`, plus the specs added earlier in this plan (`payments/qr_cleanup`, `db_context/db_context` adapter tests, `queue/tenant_job` where it reads rows).

Fix each failing spec with one of three rules, nothing else:

1. **Writes and reads of tenant-owned rows** (`Tenant`, `TenantMembership`, `PaymentMethod`, and `PaymentMethodService` calls) run in the tenant's context:

```ts
// before
await TenantMembership.create({ tenantId: otherTenant.id, userId: owner.id, role: "artist" });
const saved = await Tenant.findOrFail(tenant.id);
const method = await methods.create(tenant, { kind: "cash", label: "Cash" });

// after
await inTenant(otherTenant, () =>
	TenantMembership.create({ tenantId: otherTenant.id, userId: owner.id, role: "artist" }),
);
const saved = await inTenant(tenant, () => Tenant.findOrFail(tenant.id));
const method = await inTenant(tenant, () => methods.create(tenant, { kind: "cash", label: "Cash" }));
```

2. **A lookup of "the tenant that was just created" with no tenant in hand** (onboarding) runs as the user:

```ts
const tenant = await inUser(user, () => Tenant.findByOrFail("slug", "black-needle"));
```

3. **A negative check ("nothing was created") must run in the context that would have seen the row**, or it passes vacuously under RLS:

```ts
assert.isNull(await inUser(user, () => Tenant.findBy("slug", validTenant.slug)));
```

Do not add `FORCE`, grant the app role more, or bypass the policies in a test. If a test cannot be expressed with these rules, stop and report which one.

Run until clean: `PORT=3402 node ace test functional` then `PORT=3402 node ace test unit`
Expected: all PASS. `git diff --stat` shows changes only under `apps/platform/tests/` and the files from Steps 1 and 4.

- [ ] **Step 7: Check the migration rolls back and forward**

Run: `pnpm migrate:rollback && pnpm migrate`
Expected: rolls back the RLS migration and applies it again with no errors.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm typecheck` and `pnpm --filter @tattoo-drip/platform exec biome check .`

```bash
git add apps/platform
git commit -m "feat(platform): enable row-level security on tenant-owned tables"
```

---

### Task 8: The isolation harness

TAT-29. A declarative table of cases drives one spec and the route-coverage guard; the helper runs a positive control before the attacks so a wrong actor or an invalid body cannot pass vacuously.

**Files:**
- Create: `apps/platform/tests/isolation/cases.ts`, `apps/platform/tests/helpers/isolation.ts`
- Create: `apps/platform/tests/functional/isolation/cross_tenant.spec.ts`, `apps/platform/tests/functional/isolation/harness.spec.ts`
- Create: `.github/pull_request_template.md`
- Modify: `apps/platform/tests/helpers/tenants.ts` (`twoStudios`, `Studio`), `apps/platform/tests/support/test_routes.ts` (leak route), `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts` (coverage guard)

**Interfaces:**
- Consumes: Task 7 helpers (`inTenant`), `PaymentMethodService`, `ImageService`.
- Produces:
  - `type Studio = { tenant: Tenant; owner: User; artist: User; paymentMethod: PaymentMethod }` and `twoStudios(): Promise<{ a: Studio; b: Studio }>` in `#tests/helpers/tenants`.
  - `type IsolationCase`, `isolationCases: IsolationCase[]`, `EXEMPT_ROUTES: Record<string, string>` in `#tests/isolation/cases`.
  - `assertCrossTenantIsolation(client, assert, studios, isolationCase): Promise<void>` in `#tests/helpers/isolation`.

- [ ] **Step 1: Add `twoStudios`**

In `apps/platform/tests/helpers/tenants.ts` add (imports: `ImageService` from `#modules/media/services/image_service`, `PaymentMethodService` from `#modules/payments/services/payment_method_service`):

```ts
const paymentMethods = new PaymentMethodService(new ImageService());

async function studio(slug: string, name: string) {
	const { owner, tenant } = await studioWithOwner(slug, name);
	const artist = await artistIn(tenant, `artist@${slug}.example`);
	const paymentMethod = await inTenant(tenant, () =>
		paymentMethods.create(tenant, { kind: "cash", label: `${name} cash` }),
	);
	return { tenant, owner, artist, paymentMethod };
}

export type Studio = Awaited<ReturnType<typeof studio>>;

/**
 * Two studios, each with an owner, an artist and one payment method.
 * Later tickets add seed data for their own tables here, so every
 * isolation case sees it.
 */
export async function twoStudios() {
	return {
		a: await studio("studio-a", "Studio A"),
		b: await studio("studio-b", "Studio B"),
	};
}
```

- [ ] **Step 2: Write the case table**

Create `apps/platform/tests/isolation/cases.ts`:

```ts
import PaymentMethod from "#modules/payments/models/payment_method";
import Tenant from "#modules/tenancy/models/tenant";
import { inTenant, type Studio } from "#tests/helpers/tenants";

/**
 * One entry per /t/:tenant route. The cross-tenant spec runs each as studio
 * A's actor against studio B; the route-coverage guard in
 * tenant_routes.spec.ts fails for a route that has neither an entry here
 * nor an exemption with a reason.
 */
export type IsolationCase = {
	method: "GET" | "POST" | "PUT" | "DELETE";
	/** The route as the router prints it, e.g. /t/:tenant/settings/payments/:id */
	pattern: string;
	/** Who sends the request. Every settings route is owner-only. */
	actor: "owner" | "artist";
	/** A valid body for writes, built for the studio sending it. */
	body?: (own: Studio) => Record<string, unknown>;
	/** The status the actor gets on its own studio: the positive control. */
	ownStatus: 200 | 302;
	/** Reads the state of the targeted studio that the route could change. */
	snapshot: (target: Studio) => Promise<unknown>;
};

/**
 * Routes with no isolation case, with the reason. Empty today: even pages
 * that read nothing get a case, because the 404 for a foreign slug is
 * still worth proving.
 */
export const EXEMPT_ROUTES: Record<string, string> = {};

const none = async () => null;

const tenantRow = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(await Tenant.findOrFail(target.tenant.id)).serialize(),
	);

const methodRows = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(
			await PaymentMethod.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("position")
				.orderBy("id")
		).map((method) => method.serialize()),
	);

const profileBody = (own: Studio) => ({
	name: `${own.tenant.name} renamed`,
	timezone: "Asia/Kathmandu",
	intro: "",
	contactPhone: "",
	contactEmail: "",
	address: "",
	instagramUrl: "",
	facebookUrl: "",
	tiktokUrl: "",
	websiteUrl: "",
});

export const isolationCases: IsolationCase[] = [
	{ method: "GET", pattern: "/t/:tenant", actor: "owner", ownStatus: 200, snapshot: none },
	{ method: "GET", pattern: "/t/:tenant/settings", actor: "owner", ownStatus: 302, snapshot: none },
	{ method: "GET", pattern: "/t/:tenant/settings/profile", actor: "owner", ownStatus: 200, snapshot: tenantRow },
	{ method: "PUT", pattern: "/t/:tenant/settings/profile", actor: "owner", body: profileBody, ownStatus: 302, snapshot: tenantRow },
	{ method: "GET", pattern: "/t/:tenant/settings/payments", actor: "owner", ownStatus: 200, snapshot: methodRows },
	{
		method: "PUT",
		pattern: "/t/:tenant/settings/deposits",
		actor: "owner",
		body: () => ({ defaultDepositPercent: "30", depositPolicy: "Holds your date." }),
		ownStatus: 302,
		snapshot: tenantRow,
	},
	{ method: "GET", pattern: "/t/:tenant/settings/payments/new", actor: "owner", ownStatus: 200, snapshot: none },
	{
		method: "POST",
		pattern: "/t/:tenant/settings/payments",
		actor: "owner",
		body: () => ({ kind: "cash", label: "Another cash" }),
		ownStatus: 302,
		snapshot: methodRows,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/settings/payments/:id",
		actor: "owner",
		body: () => ({ label: "Renamed" }),
		ownStatus: 302,
		snapshot: methodRows,
	},
	{ method: "GET", pattern: "/t/:tenant/settings/payments/:id/edit", actor: "owner", ownStatus: 200, snapshot: methodRows },
	{
		method: "POST",
		pattern: "/t/:tenant/settings/payments/:id/move",
		actor: "owner",
		body: () => ({ direction: "down" }),
		ownStatus: 302,
		snapshot: methodRows,
	},
	{ method: "DELETE", pattern: "/t/:tenant/settings/payments/:id", actor: "owner", ownStatus: 302, snapshot: methodRows },
];
```

- [ ] **Step 3: Write the failing harness self-tests**

Create `apps/platform/tests/functional/isolation/harness.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { assertCrossTenantIsolation } from "#tests/helpers/isolation";
import { type IsolationCase, isolationCases } from "#tests/isolation/cases";
import { twoStudios } from "#tests/helpers/tenants";

test.group("Isolation harness catches what it should", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a route that answers a foreign studio's slug is reported", async ({
		client,
		assert,
	}) => {
		const leaky: IsolationCase = {
			method: "GET",
			pattern: "/__test/leak/:tenant",
			actor: "owner",
			ownStatus: 200,
			snapshot: async () => null,
		};

		await assert.rejects(async () =>
			assertCrossTenantIsolation(client, assert, await twoStudios(), leaky),
		);
	});

	test("the positive control fails for a wrong actor instead of passing vacuously", async ({
		client,
		assert,
	}) => {
		const profile = isolationCases.find(
			({ method, pattern }) =>
				method === "GET" && pattern === "/t/:tenant/settings/profile",
		) as IsolationCase;

		await assert.rejects(async () =>
			assertCrossTenantIsolation(
				client,
				assert,
				await twoStudios(),
				{ ...profile, actor: "artist" },
			),
		);
	});
});
```

Create `apps/platform/tests/functional/isolation/cross_tenant.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { assertCrossTenantIsolation } from "#tests/helpers/isolation";
import { twoStudios } from "#tests/helpers/tenants";
import { isolationCases } from "#tests/isolation/cases";

test.group("Cross-tenant isolation", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	for (const isolationCase of isolationCases) {
		test(`${isolationCase.method} ${isolationCase.pattern}`, async ({
			client,
			assert,
		}) => {
			await assertCrossTenantIsolation(
				client,
				assert,
				await twoStudios(),
				isolationCase,
			);
		});
	}
});
```

Add a leak route to `apps/platform/tests/support/test_routes.ts` (a route that answers any signed-in user, for the harness self-test):

```ts
router
	.get("/__test/leak/:tenant", ({ response }) => response.ok({ leaked: true }))
	.use(middleware.auth());
```

Run: `PORT=3402 node ace test functional --files=harness.spec.ts`
Expected: FAIL, cannot resolve `#tests/helpers/isolation`.

- [ ] **Step 4: Write the helper**

Create `apps/platform/tests/helpers/isolation.ts`:

```ts
import type { Assert } from "@japa/assert";
import type { ApiClient } from "@japa/api-client";
import type User from "#models/user";
import type { IsolationCase } from "#tests/isolation/cases";
import type { Studio } from "#tests/helpers/tenants";

function urlFor(pattern: string, studio: Studio, resourceOwner?: Studio) {
	return pattern
		.replace(":tenant", studio.tenant.slug)
		.replace(":id", resourceOwner?.paymentMethod.id ?? "");
}

function send(
	client: ApiClient,
	isolationCase: IsolationCase,
	url: string,
	user: User,
	body?: Record<string, unknown>,
) {
	const verb = isolationCase.method.toLowerCase() as
		| "get"
		| "post"
		| "put"
		| "delete";
	const request = client[verb](url);
	if (isolationCase.method === "GET") request.withInertia();
	else request.withCsrfToken();
	if (body) request.form(body);
	return request.loginAs(user).redirects(0);
}

/**
 * Proves studio A's actor cannot reach studio B through one route.
 *
 * First a positive control: the same request, with the same body, against
 * A's own studio must give the case's status. Without it a wrong role or an
 * invalid body would fail for other reasons and the attacks would pass
 * vacuously. Then the attacks, as the same actor: B's slug in the URL, and
 * (for routes with an :id) A's slug with B's resource id. Each must be a
 * 404, and B's snapshot must be unchanged afterwards.
 */
export async function assertCrossTenantIsolation(
	client: ApiClient,
	assert: Assert,
	{ a, b }: { a: Studio; b: Studio },
	isolationCase: IsolationCase,
) {
	const actor = isolationCase.actor === "owner" ? a.owner : a.artist;
	const body = isolationCase.body?.(a);

	const control = await send(
		client,
		isolationCase,
		urlFor(isolationCase.pattern, a, a),
		actor,
		body,
	);
	control.assertStatus(isolationCase.ownStatus);

	const attacks = [urlFor(isolationCase.pattern, b, b)];
	if (isolationCase.pattern.includes(":id")) {
		attacks.push(urlFor(isolationCase.pattern, a, b));
	}

	const before = await isolationCase.snapshot(b);
	for (const url of attacks) {
		const response = await send(client, isolationCase, url, actor, body);
		response.assertStatus(404);
		assert.deepEqual(
			await isolationCase.snapshot(b),
			before,
			`${isolationCase.method} ${url} changed studio B`,
		);
	}
}
```

- [ ] **Step 5: Run the harness tests to verify they pass**

Run: `PORT=3402 node ace test functional --files=harness.spec.ts` then `PORT=3402 node ace test functional --files=cross_tenant.spec.ts`
Expected: PASS. If a positive control reports 303 instead of 302 for a write, change that case's `ownStatus` type to include `303` and set it; if a control reports 422, the case's body is invalid for that validator: fix the body, not the helper.

- [ ] **Step 6: Add the route-coverage guard**

In `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts` add the import `import { EXEMPT_ROUTES, isolationCases } from "#tests/isolation/cases";` and this test next to the two route-group tests (it must live in the functional suite: `router.toJSON()` is empty until the HTTP server starts, and only the functional, browser and e2e suites start it):

```ts
	test("every /t/:tenant route has an isolation case or a written exemption", ({
		assert,
	}) => {
		const routes = Object.values(router.toJSON())
			.flat()
			.filter(({ pattern }) => /^\/t\/:tenant(\/|$)/.test(pattern));
		assert.isNotEmpty(routes);

		const keys = new Set(
			routes.flatMap(({ pattern, methods }) =>
				methods
					.filter((method) => method !== "HEAD")
					.map((method) => `${method} ${pattern}`),
			),
		);
		const covered = new Set([
			...isolationCases.map(({ method, pattern }) => `${method} ${pattern}`),
			...Object.keys(EXEMPT_ROUTES),
		]);

		assert.deepEqual(
			[...keys].filter((key) => !covered.has(key)),
			[],
			"add a case to tests/isolation/cases.ts, or an exemption with a reason",
		);
		assert.deepEqual(
			[...covered].filter((key) => !keys.has(key)),
			[],
			"cases or exemptions for routes that no longer exist",
		);
	});
```

Run: `PORT=3402 node ace test functional --files=tenant_routes.spec.ts`
Expected: PASS. (To see it bite, temporarily delete one case: the test names the uncovered route. Restore it.)

- [ ] **Step 7: Add the PR template**

Create `.github/pull_request_template.md`:

```markdown
## What changed

## Checklist

- [ ] Every new or changed tenant-owned endpoint (`/t/:tenant/...`) has an isolation case in `apps/platform/tests/isolation/cases.ts`, or an exemption with a reason. A test fails for a route without one.
- [ ] Every new tenant-owned table runs `enableTenantRls()` in its migration. A test fails for a table without it.
- [ ] Work outside the database (deleting files, sending email, calling APIs) uses `afterCommit` / `afterRollback`, never right after a service's own transaction returns.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass.
```

- [ ] **Step 8: Run everything and commit**

Run: `PORT=3402 node ace test` (from `apps/platform`) and `pnpm typecheck`
Expected: all PASS.

```bash
git add apps/platform .github/pull_request_template.md
git commit -m "test(platform): add the cross-tenant isolation harness and route-coverage guard"
```

### Task 9: Documentation and the ticket

The instructions the next session reads must describe the system that now exists. Keep additions short: `AGENTS.md` files are loaded into every session.

**Files:**
- Modify: `docs/architecture.md`, `apps/platform/database/README.md`, `apps/platform/docs/backend.md`, `apps/platform/docs/testing.md`, `apps/platform/docs/jobs-and-email.md`, `README.md`, `AGENTS.md`, `apps/platform/AGENTS.md`
- Linear: TAT-28 description

**Interfaces:**
- Consumes: everything above; this task only describes it.
- Produces: nothing code depends on.

- [ ] **Step 1: `docs/architecture.md`**

Replace the last sentence of the final paragraph, "Row-level security above is planned; see [database conventions](../apps/platform/database/README.md).", with:

```
Row-level security is implemented; see [database conventions](../apps/platform/database/README.md) and [backend development](../apps/platform/docs/backend.md).
```

- [ ] **Step 2: `apps/platform/database/README.md`**

In the "Every tenant-owned table has `tenant_id`" bullet, replace "Row-level security on these tables is planned (`docs/architecture.md`, Tenant context)." with "Row-level security is on for every tenant-owned table (see below)." Append this section at the end of the file:

```markdown
## Row-level security

- **Two roles.** The owner (`DB_MIGRATION_USER`, `postgres` in dev and CI) owns the tables and runs migrations through the `owner` connection: `pnpm migrate` and `pnpm migrate:rollback`. The app (`DB_USER`, `tattoo_drip_app`) is `NOSUPERUSER NOBYPASSRLS` with data access only. `database/setup_roles.sql` creates it and runs once per database (compose and CI do it). The server, the worker and the tests refuse to start as a role that bypasses RLS.
- **Context.** Each authenticated request and each `TenantJob` runs in one transaction that sets `app.user_id` and `app.tenant_id` (`app/services/db_context.ts`). Policies read them through `app_tenant_id()` and `app_user_id()`; with nothing set, queries return no rows. Raw `db` queries and Vine's `unique` and `exists` rules run outside that transaction, so they see nothing: use models, or `dbClient()`.
- **A new tenant-owned table.** In its migration, `for (const sql of enableTenantRls("quotes")) this.schema.raw(sql);` from `#database/helpers/tenant_rls` (RLS on, `UNIQUE (tenant_id, id)`, the `tenant_isolation` policy), and `tenantReference(table, "client_id", "clients")` for references to other tenant-owned tables. `tests/functional/rls/catalog_guard.spec.ts` fails for a table without them.
- **`ENABLE`, not `FORCE`.** The owner bypasses RLS, so data migrations behave the same on any Postgres. `users` is outside RLS: login and the session guard read it before any context exists.
```

- [ ] **Step 3: `apps/platform/docs/backend.md`**

After the bullet that starts "Tenant pages live in the `/t/:tenant` route group", add:

```markdown
- Database context: every authenticated request runs in one transaction (the `dbContext` middleware, right after `auth`) with `app.user_id` set, and the tenant middleware adds `app.tenant_id`. Row-level security reads them, so a query outside that transaction sees no tenant rows. Nested work uses `withTransaction` from `#services/db_context`, never `db.transaction`: inside a request it is a savepoint, so a caught unique violation leaves the request usable. `withDbContext({ tenantId }, fn)` runs `fn` as a tenant (jobs, tests, `createTenant`). Model queries, preloads and relations join the request transaction automatically; raw `db.from()` and `db.rawQuery()` do not, so use `dbClient()`. A failed request is rolled back by the exception handler. Work outside the database (deleting a file, sending an email) goes in `afterCommit` / `afterRollback`, never right after `withTransaction` returns: inside a request that is only a savepoint. Details: [database conventions](../database/README.md).
```

In the images bullet, replace "If saving the record fails, call `delete(purpose, key)` in the `catch`; when replacing an image, delete the old key after the transaction commits." with:

```
Register `afterRollback(() => images.delete(purpose, key))` first thing inside the `withTransaction` callback that saves the record, and delete a replaced key with `afterCommit`.
```

- [ ] **Step 4: `apps/platform/docs/testing.md`**

Replace "(`node ace migration:run`)" with "(`pnpm migrate`)" and "`node ace migration:run` applies migrations and regenerates `database/schema.ts`" with "`pnpm migrate` applies migrations (as the owner role) and regenerates `database/schema.ts`". Append:

```markdown
## Tenant isolation tests

Tests run as the restricted app role, so row-level security applies to them. A direct model read or write of tenant-owned rows needs a context: `inTenant(tenant, fn)`, `inUser(user, fn)` or `inTenantAs(tenant, user, fn)` from `#tests/helpers/tenants`. A negative check ("nothing was created") must run in the context that would have seen the row, or it passes vacuously.

- `twoStudios()` gives studios A and B, each with an owner, an artist and a payment method. Seed data for a new table goes there.
- Every `/t/:tenant` route needs an entry in `tests/isolation/cases.ts` (method, pattern, actor, valid body, own status, a snapshot of what it could change) or a reasoned exemption. `cross_tenant.spec.ts` runs each as studio A against studio B: a positive control first, then B's slug and, with an `:id`, B's resource id. Each attack must be a 404 with B unchanged. `tenant_routes.spec.ts` fails for a route without an entry.
- Tests that drive the queue use `processQueued()` from `#tests/helpers/worker` (the real worker). Jobs that touch tenant data extend `TenantJob`.
- Test-only routes live in `tests/support/test_routes.ts`; the functional suite registers them.
```

- [ ] **Step 5: `apps/platform/docs/jobs-and-email.md`**

Replace "Jobs that touch tenant-owned data carry `tenantId` in their payload. TAT-28 runs them in tenant context." with:

```
Jobs that touch tenant-owned data extend `TenantJob` (`#services/tenant_job`, not in `app/jobs`: the worker registers every file there as a job), implement `handle()` instead of `execute()`, and carry `tenantId` in the payload. `handle()` runs in that tenant's context and one transaction: a throw rolls every write back before the retry, and the worker acknowledges the job only after the commit. A missing or malformed `tenantId` fails the job. Jobs that touch no tenant data (`SendMailJob`) extend `Job` and are listed in the allowlist in `tests/unit/jobs/job_classes.spec.ts`.
```

- [ ] **Step 6: Root `README.md`, root `AGENTS.md`, platform `AGENTS.md`**

In `README.md`, replace `pnpm --filter @tattoo-drip/platform exec node ace migration:run` with `pnpm --filter @tattoo-drip/platform migrate`; in the paragraph after the setup block, change "It reads `DB_USER`, `DB_PASSWORD`, `DB_DATABASE` and `DB_PORT`" to "It reads `DB_MIGRATION_USER`, `DB_MIGRATION_PASSWORD`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE` and `DB_PORT`", and add after that paragraph:

```markdown
The database has two roles. `DB_MIGRATION_USER` (the owner, `postgres` by default) owns the tables and runs migrations; `DB_USER` (`tattoo_drip_app`) is the restricted role the app connects as, and row-level security applies to it, not to the owner. A new volume gets the app role from `docker/postgres/init`. For an existing dev database, create it once, then copy the new `DB_*` lines from `apps/platform/.env.example` into your `.env`:

    PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d tattoo_drip -v ON_ERROR_STOP=1 \
      -v app_user=tattoo_drip_app -v app_password=tattoo_drip_app -v owner_user=postgres \
      -f apps/platform/database/setup_roles.sql
```

In the root `AGENTS.md` "Generated files" list, replace "new migration, then `node ace migration:run` in platform" with "new migration, then `pnpm migrate` in platform (migrations run as the owner role)".

In `apps/platform/AGENTS.md`, under "Essential constraints" add after the tenant line:

```
- Row-level security backs the scoping. Tenant queries run in the request transaction (`#services/db_context`), a new tenant-owned table runs `enableTenantRls()` in its migration, and jobs that touch tenant data extend `TenantJob`. Read the database context bullet in backend conventions before touching either.
```

and in "Commands" add `pnpm migrate` (migrations run as the owner role) to the list.

- [ ] **Step 7: Update the TAT-28 ticket**

Load the Linear tools if needed (`ToolSearch` with `select:mcp__claude_ai_Linear__get_issue,mcp__claude_ai_Linear__save_issue`). Fetch TAT-28 (`get_issue`, fields `description`). If its third checkbox still mentions `executionWrapper`, save the description with that checkbox replaced by:

```
- [ ] Run each queued job that touches tenant data in tenant context: jobs extend `TenantJob` (`app/services/tenant_job.ts`), which runs `handle()` in one transaction with the `tenantId` from the job payload (convention set in TAT-7). Not `executionWrapper`: the worker swallows a job's error inside the wrapper and acknowledges the job before a wrapper could commit.
```

If it is already updated, skip.

- [ ] **Step 8: Check the docs and commit**

Run: `rg -n 'migration:run|planned|TAT-28 runs' docs apps/platform/docs apps/platform/database/README.md README.md AGENTS.md apps/platform/AGENTS.md -g '!superpowers'`
Expected: no stale `node ace migration:run` instruction, no "Row-level security … planned", no "TAT-28 runs them". (A mention of `migration:run` inside the `pnpm migrate` explanation is fine.)

```bash
git add docs apps/platform README.md AGENTS.md
git commit -m "docs(platform): describe row-level security, the database context and the isolation harness"
```

---

### Task 10: Whole-branch verification and review gates

**Files:** none (verification only; fixes go to the files they concern).

- [ ] **Step 1: Static checks**

Run (repository root): `pnpm check && pnpm typecheck && pnpm build`
Expected: all succeed.

- [ ] **Step 2: The full test suite**

Run: `PORT=3402 pnpm test`
Expected: every suite PASSES. Count the new specs: `db_context` (3 files), `rls` (4), `isolation` (2), `queue/tenant_job`, `unit/database/tenant_rls`, `unit/jobs/job_classes`.

- [ ] **Step 3: Migrations roll back and forward, schema stays committed**

Run (from `apps/platform`):

```bash
pnpm migrate:rollback && pnpm migrate
pnpm exec biome check --write database/schema.ts
git status --short database/schema.ts
```

Expected: no errors; `git status` shows `database/schema.ts` unchanged.

- [ ] **Step 4: From-scratch bootstrap on an empty volume (throwaway project, your dev data untouched)**

```bash
cd /home/blank/Coding/tattoo-drip
DB_PORT=55432 PODMAN_COMPOSE_PROVIDER=podman-compose podman compose -p rlscheck --env-file apps/platform/.env up -d postgres
sleep 15
cd apps/platform
DB_PORT=55432 pnpm migrate
DB_PORT=55432 PORT=3402 node ace test functional
cd ../.. && PODMAN_COMPOSE_PROVIDER=podman-compose podman compose -p rlscheck --env-file apps/platform/.env down -v
```

Expected: the container becomes healthy, migrations apply as the owner, and the whole functional suite passes as the app role on a brand-new cluster.

- [ ] **Step 5: Codegen is clean**

Run: `node ace codegen` (from `apps/platform`), then `git status --short`.
Expected: nothing under `.adonisjs/` changes.

- [ ] **Step 6: Review gates**

Run the `codex-review` skill on this branch (code review and security review, as the project's memory prescribes). Triage every finding by reading the cited lines: fix confirmed ones that are small and in scope, ask before design-level ones, and say which reviews ran and what they found.

Run the whole suite again after any fix (`PORT=3402 pnpm test`).

- [ ] **Step 7: Hand back**

Do not push. Summarize for the user: commits on the branch, test counts, anything skipped, and the open follow-ups already listed in the spec's "not in scope" section (`users` RLS, public API slug lookup, reserved slugs, invitation context). Pushing and opening the PR need the user's go-ahead; the pre-push hook asks as well. When opening the PR, tick every item in the new template.

---

## Self-Review

**Spec coverage.**

| Spec section | Task |
|---|---|
| Roles and connections (roles, env, `owner` connection, `setup_roles.sql`, compose, boot guard, `ENABLE` not `FORCE`) | 5 (ENABLE in 7) |
| Request context: `withDbContext`, `withTransaction`, `afterCommit` / `afterRollback`, `dbClient`, `abortRequestTransaction`, adapter, `set_config` | 1 |
| Middleware: `dbContext`, tenant middleware, `createTenant`, exception handler, share(), route-group test, real-pipeline tests | 2, 3 |
| Policies and the signed-in-user note | 7 |
| Migration helpers | 7 |
| Jobs: `TenantJob`, guard test, allowlist, ticket text | 4, 9 |
| TAT-29 harness: factories, case table, helper with positive control, coverage guard (functional), PR template | 4 (`inTenant`), 7 (sweep), 8 |
| RLS-layer tests (select, no context, insert, update and delete, tenant-moving UPDATE, user-context policies, role guard) | 5, 7 |
| Catalog guard (exemptions, exact policies, no literal `true`, explicit write checks, `UNIQUE (tenant_id, id)`, composite FKs) | 7 |
| Job tests (real worker, rollback per attempt, ack after commit, no leak, malformed id, class guard) | 4, 7 |
| Changes outside the new code (validator and message, handler, config, env, compose, CI, docs, `PaymentMethodService`, `pnpm migrate`) | 2, 3, 5, 6, 9 |
| Open risks (adapter coverage, AsyncLocalStorage in the handler, worker, savepoint restore, exception-handler store) | 1, 2, 4 each name the fallback |

**Placeholder scan.** No to-be-decided markers, no "handle edge cases" steps. Three steps give a procedure instead of finished code on purpose, because the right edit depends on a failure only the run shows: the spec sweep (Task 7 Step 6, with three exact rules and before/after code), the `ownStatus` / body corrections for the isolation cases (Task 8 Step 5), and the `Tenant.create({ id })` fallback (Task 3 Step 4). Each names the failing condition and the exact change.

**Type consistency.** `withDbContext(values, fn(trx))`, `withTransaction(fn(trx))`, `ensureDbContext(values, fn())`, `runInRequestTransaction(values, fn())`, `setRequestContext(values)`, `abortRequestTransaction()`, `afterCommit(fn)`, `afterRollback(fn)`, `dbClient()`, `currentClient()` are defined in Task 1 and used with those signatures in Tasks 2–8. `inTenant` is defined in Task 4 and used in 7 and 8; `inUser` and `inTenantAs` in Task 7. `Studio` and `twoStudios` are defined in Task 8 and used only there. `TenantJob` lives in `#services/tenant_job` everywhere (spec amended in Task 4). `enableTenantRls` returns statements everywhere it is used.

**Review Focus coverage.** Callback that throws (Task 1), abort twice or outside a request (Task 1), validation failure after a write (Task 2), `setup_roles.sql` idempotence, normalization and refusal (Task 5), member-of-owner guard case (Task 5).

