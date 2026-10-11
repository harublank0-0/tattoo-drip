import type { HttpContext } from "@adonisjs/core/http";
import router from "@adonisjs/core/services/router";
import { errors } from "@vinejs/vine";
import User from "#models/user";
import PaymentMethod from "#modules/payments/models/payment_method";
import {
	afterCommit,
	afterRollback,
	dbClient,
	setRequestContext,
} from "#services/db_context";
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

async function settings({ response }: HttpContext) {
	const { rows } = await dbClient().rawQuery(
		"select current_setting('app.user_id', true) as user_id, current_setting('app.tenant_id', true) as tenant_id",
	);
	return response.json(rows[0]);
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
		router.get("settings", settings);
	})
	.prefix("/__test/db")
	.use([middleware.auth(), middleware.dbContext()]);

/**
 * The same settings read from a tenant route, to see what the tenant
 * middleware set.
 */
router
	.get("/t/:tenant/__test/db/settings", settings)
	.use([middleware.auth(), middleware.dbContext(), middleware.tenant()]);

/**
 * A route that answers any signed-in user whatever the slug: the leak the
 * isolation harness must report (tests/functional/isolation/harness.spec.ts).
 */
router
	.get("/__test/leak/:tenant", ({ response }) => response.ok({ leaked: true }))
	.use(middleware.auth());

/**
 * Payment-method id -> id of the tenant that owns it, filled by the test that
 * uses the IDOR route below. Under row-level security a handler cannot find
 * another tenant's row from a request that is not in that tenant's context, so
 * this stands in for the lookup a buggy handler would make.
 */
export const idorOwners = new Map<string, string>();

/**
 * A handler that checks the slug (auth, request transaction and the tenant
 * middleware, so the caller must be a member of :tenant) but then trusts the
 * :id: it switches the request to the tenant that owns the id and deletes the
 * method. That is the IDOR leak (A's slug with B's id) the isolation harness's
 * second attack must report; a slug-only leak like /__test/leak/:tenant is
 * caught by the first. Not under /t/:tenant, so the coverage guard ignores it.
 */
router
	.delete(
		"/__test/idor/:tenant/payment-methods/:id",
		async ({ params, response }) => {
			const owner = idorOwners.get(params.id);
			if (!owner) return response.notFound();
			await setRequestContext({ tenantId: owner });
			const method = await PaymentMethod.query().where("id", params.id).first();
			if (!method) return response.notFound();
			await method.softDelete();
			return response.ok({ deleted: true });
		},
	)
	.use([middleware.auth(), middleware.dbContext(), middleware.tenant()]);
