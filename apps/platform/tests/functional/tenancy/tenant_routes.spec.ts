import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
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
});
