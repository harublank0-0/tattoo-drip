import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import Tenant from "#modules/tenancy/models/tenant";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { assertValidationError } from "#tests/helpers/validation";

const PASSWORD = "secret-password";

function makeUser(email = "ink@example.com") {
	return User.create({ email, password: PASSWORD });
}

const validTenant = {
	name: "Black Needle",
	type: "studio",
	slug: "black-needle",
	timezone: "Asia/Kathmandu",
};

test.group("Onboarding", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("shows the form to a signed-in user", async ({ client }) => {
		const user = await makeUser();

		const response = await client.get("/onboarding").loginAs(user);

		response.assertStatus(200);
	});

	test("sends a signed-out visitor to the login page", async ({ client }) => {
		const response = await client.get("/onboarding").redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/login");
	});

	test("creates the tenant with the user as owner, then opens the dashboard", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();

		const response = await client
			.post("/onboarding")
			.form({ ...validTenant, slug: "  Black-Needle " })
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/dashboard");
		const tenant = await Tenant.findByOrFail("slug", "black-needle");
		assert.equal(tenant.name, "Black Needle");
		const membership = await TenantMembership.query()
			.where("tenant_id", tenant.id)
			.firstOrFail();
		assert.equal(membership.userId, user.id);
		assert.equal(membership.role, "owner");
	});

	for (const [field, value] of [
		["slug", "not a slug!"],
		["slug", "ab"],
		["slug", "-black-needle"],
		["timezone", "Mars/Olympus_Mons"],
		["type", "agency"],
		["name", ""],
	] as const) {
		test(`rejects ${field} = "${value}"`, async ({ client, assert }) => {
			const user = await makeUser();

			const response = await client
				.post("/onboarding")
				.form({ ...validTenant, [field]: value })
				.withCsrfToken()
				.loginAs(user)
				.redirects(0);

			assertValidationError(response, field);
			assert.isNull(await Tenant.findBy("slug", validTenant.slug));
		});
	}

	test("rejects a slug that's already taken", async ({ client }) => {
		const someone = await makeUser("someone@example.com");
		await new TenancyService().createTenant(someone, {
			...validTenant,
			type: "studio",
		});
		const user = await makeUser();

		const response = await client
			.post("/onboarding")
			.form(validTenant)
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

		assertValidationError(response, "slug");
	});
});

test.group("Where users land", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("signup lands on onboarding", async ({ client }) => {
		const response = await client
			.post("/signup")
			.form({
				fullName: "Ada Ink",
				email: "ada@example.com",
				password: PASSWORD,
				passwordConfirmation: PASSWORD,
			})
			.withCsrfToken()
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/onboarding");
	});

	test("login without a tenant lands on onboarding", async ({ client }) => {
		await makeUser();

		const response = await client
			.post("/login")
			.form({ email: "ink@example.com", password: PASSWORD })
			.withCsrfToken()
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/onboarding");
	});

	test("login with a tenant lands on the dashboard", async ({ client }) => {
		const user = await makeUser();
		await new TenancyService().createTenant(user, {
			...validTenant,
			type: "studio",
		});

		const response = await client
			.post("/login")
			.form({ email: "ink@example.com", password: PASSWORD })
			.withCsrfToken()
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/dashboard");
	});
});
