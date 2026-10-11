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
const OTHER_TENANT = "00000000-0000-4000-8000-000000000003";

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

	test("sequential contexts under one parent each inherit the parent's values, not each other's", async ({
		assert,
	}) => {
		await withDbContext({ tenantId: TENANT }, async () => {
			await withDbContext(
				{ userId: USER, tenantId: OTHER_TENANT },
				async () => {
					assert.equal(await setting("app.user_id"), USER);
					assert.equal(await setting("app.tenant_id"), OTHER_TENANT);
				},
			);

			await withDbContext({}, async () => {
				assert.isNull(await setting("app.user_id"));
				assert.equal(await setting("app.tenant_id"), TENANT);
			});

			assert.isNull(await setting("app.user_id"));
			assert.equal(await setting("app.tenant_id"), TENANT);
		});
	});

	test("overlapping contexts under one parent are refused and leave the parent's settings alone", async ({
		assert,
	}) => {
		await withDbContext({ userId: USER, tenantId: TENANT }, async () => {
			const results = await Promise.allSettled([
				withDbContext({ tenantId: OTHER_TENANT }, async () =>
					setting("app.tenant_id"),
				),
				withDbContext({}, async () => setting("app.tenant_id")),
			]);

			assert.equal(results[0].status, "fulfilled");
			assert.equal(
				(results[0] as PromiseFulfilledResult<string | null>).value,
				OTHER_TENANT,
			);
			assert.equal(results[1].status, "rejected");
			assert.match(
				String((results[1] as PromiseRejectedResult).reason),
				/Overlapping withDbContext calls in one transaction/,
			);

			assert.equal(await setting("app.user_id"), USER);
			assert.equal(await setting("app.tenant_id"), TENANT);
		});
	});

	test("a context can start again once the previous one has finished", async ({
		assert,
	}) => {
		await withDbContext({ tenantId: TENANT }, async () => {
			await assert.rejects(
				() =>
					withDbContext({ tenantId: OTHER_TENANT }, async () => {
						throw new Error("first fails");
					}),
				"first fails",
			);
			await withDbContext({ userId: USER }, async () => {
				assert.equal(await setting("app.tenant_id"), TENANT);
			});
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
		assert.throws(
			() => afterCommit(() => {}),
			/open request or job transaction/,
		);
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

	test("values set at the request level reach the wrappers started after", async ({
		assert,
	}) => {
		await runInRequestTransaction({}, async () => {
			await setRequestContext({ userId: USER });
			await setRequestContext({ tenantId: TENANT });

			await withDbContext({}, async () => {
				assert.equal(await setting("app.user_id"), USER);
				assert.equal(await setting("app.tenant_id"), TENANT);
			});

			await withTransaction(async () => {
				await withDbContext({ userId: OTHER_TENANT }, async () => {
					assert.equal(await setting("app.user_id"), OTHER_TENANT);
					assert.equal(await setting("app.tenant_id"), TENANT);
				});
			});

			assert.equal(await setting("app.user_id"), USER);
			assert.equal(await setting("app.tenant_id"), TENANT);
		});
	});

	test("setRequestContext inside a nested wrapper throws and changes nothing", async ({
		assert,
	}) => {
		await runInRequestTransaction({ userId: USER }, async () => {
			await withDbContext({}, async () => {
				await assert.rejects(
					() => setRequestContext({ tenantId: TENANT }),
					/setRequestContext.*outermost/,
				);
				assert.isNull(await setting("app.tenant_id"));
			});

			await withTransaction(async () => {
				await assert.rejects(
					() => setRequestContext({ tenantId: TENANT }),
					/setRequestContext.*outermost/,
				);
			});

			await withDbContext({}, async () => {
				assert.isNull(await setting("app.tenant_id"));
			});
			assert.isNull(await setting("app.tenant_id"));
		});
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

	test("abortRequestTransaction outside a request does nothing", async ({
		assert,
	}) => {
		await assert.doesNotReject(() => abortRequestTransaction());
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
			// Lucid keeps a transaction client on `$trx`; `$options` only holds the
			// connection name.
			assert.strictEqual(membership.$trx, trx);
			assert.strictEqual(membership.tenant.$trx, trx);
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
});
