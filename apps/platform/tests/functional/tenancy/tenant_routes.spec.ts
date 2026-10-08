import router from "@adonisjs/core/services/router";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { LAST_TENANT_KEY, tenantContext } from "#middleware/tenant_middleware";
import User from "#models/user";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import TenancyService from "#modules/tenancy/services/tenancy_service";

const tenancy = new TenancyService();

function makeUser(email: string) {
	return User.create({ email, password: "secret-password" });
}

function studio(slug: string, name = "Black Needle") {
	return { type: "studio" as const, name, slug, timezone: "Asia/Kathmandu" };
}

test.group("Tenant routes", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a member opens their tenant, with tenant and switcher props", async ({
		client,
		assert,
	}) => {
		const owner = await makeUser("owner@example.com");
		await tenancy.createTenant(owner, studio("black-needle"));
		const other = await makeUser("other@example.com");
		const otherTenant = await tenancy.createTenant(
			other,
			studio("red-ink", "Red Ink"),
		);
		await TenantMembership.create({
			tenantId: otherTenant.id,
			userId: owner.id,
			role: "artist",
		});

		const response = await client
			.get("/t/black-needle")
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("dashboard");
		assert.deepEqual(response.inertiaProps.tenant, {
			name: "Black Needle",
			slug: "black-needle",
			type: "studio",
			role: "owner",
		});
		assert.deepEqual(response.inertiaProps.tenants, [
			{ name: "Black Needle", slug: "black-needle", role: "owner" },
			{ name: "Red Ink", slug: "red-ink", role: "artist" },
		]);
	});

	test("a signed-out visitor goes to the login page", async ({ client }) => {
		const response = await client.get("/t/black-needle").redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/login");
	});

	test("a member of another tenant gets 404", async ({ client }) => {
		const owner = await makeUser("owner@example.com");
		await tenancy.createTenant(owner, studio("black-needle"));
		const stranger = await makeUser("stranger@example.com");
		await tenancy.createTenant(stranger, studio("red-ink"));

		const response = await client.get("/t/black-needle").loginAs(stranger);

		response.assertStatus(404);
	});

	test("a user without any tenant gets 404", async ({ client }) => {
		const owner = await makeUser("owner@example.com");
		await tenancy.createTenant(owner, studio("black-needle"));
		const nobody = await makeUser("nobody@example.com");

		const response = await client.get("/t/black-needle").loginAs(nobody);

		response.assertStatus(404);
	});

	test("an unknown slug gets 404", async ({ client }) => {
		const owner = await makeUser("owner@example.com");
		await tenancy.createTenant(owner, studio("black-needle"));

		const response = await client.get("/t/no-such-studio").loginAs(owner);

		response.assertStatus(404);
	});

	test("a slug in different case gets 404", async ({ client }) => {
		const owner = await makeUser("owner@example.com");
		await tenancy.createTenant(owner, studio("black-needle"));

		const response = await client.get("/t/Black-Needle").loginAs(owner);

		response.assertStatus(404);
	});

	test("a member removed a moment ago gets 404 on the next request", async ({
		client,
	}) => {
		const owner = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(owner, studio("black-needle"));
		const artistUser = await makeUser("artist@example.com");
		const artist = await TenantMembership.create({
			tenantId: tenant.id,
			userId: artistUser.id,
			role: "artist",
		});
		(await client.get("/t/black-needle").loginAs(artistUser)).assertStatus(200);

		await artist.softDelete();

		const response = await client.get("/t/black-needle").loginAs(artistUser);
		response.assertStatus(404);
	});

	test("a deleted tenant gets 404", async ({ client }) => {
		const owner = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(owner, studio("black-needle"));
		await tenant.softDelete();

		const response = await client.get("/t/black-needle").loginAs(owner);

		response.assertStatus(404);
	});

	test("every /t/:tenant route runs auth, then the tenant check", ({
		assert,
	}) => {
		const routes = Object.values(router.toJSON())
			.flat()
			.filter(({ pattern }) => /^\/t\/:tenant(\/|$)/.test(pattern));
		assert.isNotEmpty(routes);

		for (const route of routes) {
			const names = [...route.middleware.all()].map((entry) =>
				typeof entry === "function" ? undefined : entry.name,
			);
			assert.include(names, "tenant", route.pattern);
			assert.isBelow(names.indexOf("auth"), names.indexOf("tenant"));
			assert.notEqual(names.indexOf("auth"), -1, route.pattern);
		}
	});

	test("tenantContext fails loudly outside a tenant route", async ({
		assert,
	}) => {
		const ctx = await testUtils.createHttpContext();

		assert.throws(() => tenantContext(ctx), /tenant middleware/);
	});
});

test.group("Dashboard landing", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("no tenant goes to onboarding", async ({ client }) => {
		const user = await makeUser("new@example.com");

		const response = await client.get("/dashboard").loginAs(user).redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/onboarding");
	});

	test("one tenant goes straight to it", async ({ client }) => {
		const owner = await makeUser("owner@example.com");
		await tenancy.createTenant(owner, studio("black-needle"));

		const response = await client.get("/dashboard").loginAs(owner).redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/t/black-needle");
	});

	test("goes back to the tenant opened last", async ({ client }) => {
		const owner = await makeUser("owner@example.com");
		await tenancy.createTenant(owner, studio("black-needle"));
		const other = await makeUser("other@example.com");
		const redInk = await tenancy.createTenant(other, studio("red-ink"));
		await TenantMembership.create({
			tenantId: redInk.id,
			userId: owner.id,
			role: "artist",
		});

		const response = await client
			.get("/dashboard")
			.withSession({ [LAST_TENANT_KEY]: "red-ink" })
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", "/t/red-ink");
	});

	test("falls back to the oldest tenant if the last one is gone", async ({
		client,
	}) => {
		const owner = await makeUser("owner@example.com");
		await tenancy.createTenant(owner, studio("black-needle"));
		const other = await makeUser("other@example.com");
		const redInk = await tenancy.createTenant(other, studio("red-ink"));
		const removed = await TenantMembership.create({
			tenantId: redInk.id,
			userId: owner.id,
			role: "artist",
		});
		await removed.softDelete();

		const response = await client
			.get("/dashboard")
			.withSession({ [LAST_TENANT_KEY]: "red-ink" })
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", "/t/black-needle");
	});

	test("visiting a tenant makes it the one /dashboard returns to", async ({
		client,
	}) => {
		const owner = await makeUser("owner@example.com");
		await tenancy.createTenant(owner, studio("black-needle"));

		const response = await client.get("/t/black-needle").loginAs(owner);

		response.assertSession(LAST_TENANT_KEY, "black-needle");
	});

	test("logging out forgets the last tenant", async ({ client }) => {
		const owner = await makeUser("owner@example.com");

		const response = await client
			.post("/logout")
			.withSession({ [LAST_TENANT_KEY]: "black-needle" })
			.loginAs(owner)
			.withCsrfToken()
			.redirects(0);

		response.assertSessionMissing(LAST_TENANT_KEY);
	});

	test("logging in forgets the last tenant of the browser's previous user", async ({
		client,
	}) => {
		await makeUser("owner@example.com");

		const response = await client
			.post("/login")
			.form({ email: "owner@example.com", password: "secret-password" })
			.withSession({ [LAST_TENANT_KEY]: "red-ink" })
			.withCsrfToken()
			.redirects(0);

		response.assertSessionMissing(LAST_TENANT_KEY);
	});
});
