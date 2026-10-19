import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import Artist from "#modules/artists/models/artist";
import Tenant from "#modules/tenancy/models/tenant";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
import { inTenant, inUser } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const PASSWORD = "secret-password";

/** Creating a tenant needs a confirmed address (TAT-18). */
function makeUser(email = "ink@example.com") {
	return User.create({
		email,
		password: PASSWORD,
		emailVerifiedAt: DateTime.now(),
	});
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
		const tenant = await inUser(user, () =>
			Tenant.findByOrFail("slug", "black-needle"),
		);
		assert.equal(tenant.name, "Black Needle");
		const membership = await inTenant(tenant, () =>
			TenantMembership.query().where("tenant_id", tenant.id).firstOrFail(),
		);
		assert.equal(membership.userId, user.id);
		assert.equal(membership.role, "owner");
	});

	test("an independent artist's new tenant comes with their profile", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();

		await client
			.post("/onboarding")
			.form({ ...validTenant, type: "independent" })
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

		const tenant = await inUser(user, () =>
			Tenant.findByOrFail("slug", "black-needle"),
		);
		const profiles = await inTenant(tenant, () =>
			Artist.query().where("tenant_id", tenant.id),
		);
		assert.lengthOf(profiles, 1);
		assert.equal(profiles[0].name, "Black Needle");
		assert.equal(profiles[0].userId, user.id);
	});

	test("a studio's new tenant has no profile", async ({ client, assert }) => {
		const user = await makeUser();

		await client
			.post("/onboarding")
			.form(validTenant)
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

		const tenant = await inUser(user, () =>
			Tenant.findByOrFail("slug", "black-needle"),
		);
		assert.isEmpty(
			await inTenant(tenant, () =>
				Artist.query().where("tenant_id", tenant.id),
			),
		);
	});

	for (const [field, value] of [
		["slug", "not a slug!"],
		["slug", "ab"],
		["slug", "-black-needle"],
		["slug", "black--needle"],
		["slug", "xn--black-needle"],
		["slug", "12345"],
		["slug", "www"],
		["slug", "Admin"],
		["slug", "Kat"],
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
			// As the user: the tenant would show here had it been created.
			assert.isNull(
				await inUser(user, () => Tenant.findBy("slug", validTenant.slug)),
			);
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

		assertValidationError(
			response,
			"slug",
			"This address is already taken. Try another one.",
		);
	});

	test("rejects another studio's old slug", async ({ client, assert }) => {
		const someone = await makeUser("someone@example.com");
		const tenant = await new TenancyService().createTenant(someone, {
			...validTenant,
			type: "studio",
		});
		await inTenant(tenant, () =>
			dbClient().rawQuery("update tenants set slug = 'red-ink' where id = ?", [
				tenant.id,
			]),
		);
		const user = await makeUser();

		const response = await client
			.post("/onboarding")
			.form(validTenant)
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

		assertValidationError(
			response,
			"slug",
			"This address is already taken. Try another one.",
		);
		assert.isFalse(
			await inUser(user, () => new TenancyService().hasTenant(user)),
		);
	});

	for (const [typed, stored] of [
		["asia/KATHMANDU", "Asia/Kathmandu"],
		["Asia/Katmandu", "Asia/Kathmandu"],
		["US/Eastern", "America/New_York"],
	] as const) {
		test(`stores time zone "${typed}" as "${stored}"`, async ({
			client,
			assert,
		}) => {
			const user = await makeUser();

			await client
				.post("/onboarding")
				.form({ ...validTenant, timezone: typed })
				.withCsrfToken()
				.loginAs(user)
				.redirects(0);

			const tenant = await inUser(user, () =>
				Tenant.findByOrFail("slug", validTenant.slug),
			);
			assert.equal(tenant.timezone, stored);
		});
	}

	test("sends a user who already has a tenant to the dashboard", async ({
		client,
	}) => {
		const user = await makeUser();
		await new TenancyService().createTenant(user, {
			...validTenant,
			type: "studio",
		});

		const response = await client.get("/onboarding").loginAs(user).redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/dashboard");
	});

	test("won't create a second tenant for a user who has one", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		await new TenancyService().createTenant(user, {
			...validTenant,
			type: "studio",
		});

		const response = await client
			.post("/onboarding")
			.form({ ...validTenant, slug: "second-shop" })
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/dashboard");
		// As the user: the tenant would show here had it been created.
		assert.isNull(
			await inUser(user, () => Tenant.findBy("slug", "second-shop")),
		);
	});
});

test.group("Where users land", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("signup lands on the check-your-email page, signed out (TAT-18)", async ({
		client,
	}) => {
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
		response.assertHeader("location", "/signup/sent");
		response.assertSessionMissing("auth_web");
	});

	test("login without a tenant also goes to /dashboard, which sends it to onboarding", async ({
		client,
	}) => {
		await makeUser();

		const response = await client
			.post("/login")
			.form({ email: "ink@example.com", password: PASSWORD })
			.withCsrfToken()
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/dashboard");
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
