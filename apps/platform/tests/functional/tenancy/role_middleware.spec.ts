import { errors, type HttpContext } from "@adonisjs/core/http";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import RoleMiddleware from "#middleware/role_middleware";
import type Tenant from "#modules/tenancy/models/tenant";
import type TenantMembership from "#modules/tenancy/models/tenant_membership";

/** A request on the tenant route `name`, by a member with `role`. */
async function requestAs(role: "owner" | "artist", name: string | undefined) {
	const ctx = await testUtils.createHttpContext();
	ctx.tenant = { id: "t", slug: "roles-30" } as unknown as Tenant;
	ctx.membership = { role } as unknown as TenantMembership;
	ctx.route = {
		name,
		pattern: "/t/:tenant/somewhere",
	} as unknown as HttpContext["route"];
	return ctx;
}

/** Runs the middleware; gives whether the handler ran and what it threw. */
async function run(ctx: HttpContext) {
	let ran = false;
	const error = await new RoleMiddleware()
		.handle(ctx, async () => {
			ran = true;
		})
		.then(
			() => null,
			(caught: unknown) => caught,
		);
	return { ran, error };
}

test.group("RoleMiddleware (TAT-30)", () => {
	test("lets a role the table allows through", async ({ assert }) => {
		for (const [role, name] of [
			["owner", "tenant.inbox.index"],
			["owner", "tenant.projects.show"],
			["artist", "tenant.projects.show"],
		] as const) {
			const { ran, error } = await run(await requestAs(role, name));
			assert.isNull(error, `${role} ${name}`);
			assert.isTrue(ran, `${role} ${name}`);
		}
	});

	test("gives any other role the router's 404, and the handler never runs", async ({
		assert,
	}) => {
		const { ran, error } = await run(
			await requestAs("artist", "tenant.inbox.index"),
		);
		assert.instanceOf(error, errors.E_ROUTE_NOT_FOUND);
		assert.isFalse(ran);
	});

	test("a route the table doesn't name fails loudly, for owners too", async ({
		assert,
	}) => {
		for (const name of ["tenant.not_in_the_table", undefined]) {
			const { ran, error } = await run(await requestAs("owner", name));
			assert.instanceOf(error, Error);
			assert.notInstanceOf(error, errors.E_ROUTE_NOT_FOUND);
			assert.match(String(error), /No TENANT_ROUTE_ROLES entry/);
			assert.isFalse(ran);
		}
	});
});
