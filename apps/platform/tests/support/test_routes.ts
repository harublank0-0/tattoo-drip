import type { HttpContext } from "@adonisjs/core/http";
import router from "@adonisjs/core/services/router";
import { LimiterResponse, errors as limiterErrors } from "@adonisjs/limiter";
import db from "@adonisjs/lucid/services/db";
import vine, { errors } from "@vinejs/vine";
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
		// A handler that reaches the database through the db service instead of
		// the request's transaction (tests/functional/db_context/escaped_queries.spec.ts).
		router.get("escaped", async ({ response }) => {
			await db.rawQuery("select 1");
			return response.noContent();
		});
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

/**
 * Tenant id of the studio whose request may collaterally write -> where:
 * the other studio's tenant id and the id of its payment method. Filled by
 * the test that uses the collateral route below.
 */
export const collateralTargets = new Map<
	string,
	{ tenantId: string; methodId: string }
>();

/**
 * A handler whose valid request does what it should (deletes the caller's own
 * payment method) and also deletes another studio's method, as a handler with
 * a stray write would. The caller's own request gets its 200 and its own
 * change, so only a check of the other studio around that request reports
 * it. It switches to the other tenant the way the IDOR route does. Not under
 * /t/:tenant, so the coverage guard ignores it.
 */
router
	.delete(
		"/__test/collateral/:tenant/payment-methods/:id",
		async ({ params, response }) => {
			const own = await PaymentMethod.query().where("id", params.id).first();
			if (!own) return response.notFound();
			await own.softDelete();
			const target = collateralTargets.get(own.tenantId);
			if (target) {
				await setRequestContext({ tenantId: target.tenantId });
				const other = await PaymentMethod.query()
					.where("id", target.methodId)
					.first();
				await other?.softDelete();
			}
			return response.ok({ deleted: true });
		},
	)
	.use([middleware.auth(), middleware.dbContext(), middleware.tenant()]);

/**
 * Public API routes for the API tests (TAT-32), outside any tenant: they
 * exercise the stateless stack and the error envelope before a real
 * endpoint needs them. Each answers with { data } or throws one kind of
 * error.
 */
export const echoValidator = vine.create({
	label: vine.string().trim().minLength(1).maxLength(20),
});

router
	.group(() => {
		router.get("ok", () => ({ data: { ok: true } }));
		router.post("echo", async ({ request }) => ({
			data: await request.validateUsing(echoValidator),
		}));
		router.get("throws", () => {
			throw new Error(
				"connection refused at 10.0.0.5:5432 for tattoo_drip_app",
			);
		});
		router.get("throttled", () => {
			throw new limiterErrors.E_TOO_MANY_REQUESTS(
				new LimiterResponse({
					limit: 10,
					remaining: 0,
					consumed: 11,
					availableIn: 42,
				}),
			);
		});
	})
	.prefix("/api/v1/__test")
	.use(middleware.publicApi());
