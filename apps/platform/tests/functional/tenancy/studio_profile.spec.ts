import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Tenant from "#modules/tenancy/models/tenant";
import { artistIn, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

/**
 * The form as the browser sends it: empty fields are "".
 */
const form = {
	name: "Black Needle Tattoo",
	timezone: "Asia/Kathmandu",
	intro: "Fine-line and blackwork in Thamel.",
	contactPhone: "98-1234-5678",
	contactEmail: "hello@blackneedle.example",
	address: "Thamel, Kathmandu",
	instagramUrl: "https://instagram.com/blackneedle",
	facebookUrl: "",
	tiktokUrl: "",
	websiteUrl: "",
};

test.group("Studio settings access", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner opens the profile page with the current profile", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.get("/t/black-needle/settings/profile")
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("settings/profile");
		assert.equal(response.inertiaProps.profile.name, "Black Needle");
		assert.isNull(response.inertiaProps.profile.intro);
		assert.include(response.inertiaProps.timezones, "Asia/Kathmandu");
	});

	test("/settings opens the profile page", async ({ client }) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.get("/t/black-needle/settings")
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/t/black-needle/settings/profile");
	});

	test("an artist gets 404 on every profile route", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);

		for (const request of [
			client.get("/t/black-needle/settings"),
			client.get("/t/black-needle/settings/profile"),
			client.put("/t/black-needle/settings/profile").form(form),
		]) {
			const response = await request.withCsrfToken().loginAs(artist);
			response.assertStatus(404);
		}
		assert.equal((await Tenant.findOrFail(tenant.id)).name, "Black Needle");
	});
});

test.group("Saving the studio profile", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner saves the profile, with the phone in E.164", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.put("/t/black-needle/settings/profile")
			.form(form)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/t/black-needle/settings/profile");
		response.assertFlashMessage("success", "Profile saved.");
		const saved = await Tenant.findOrFail(tenant.id);
		assert.equal(saved.name, "Black Needle Tattoo");
		assert.equal(saved.contactPhone, "+9779812345678");
		assert.equal(saved.instagramUrl, "https://instagram.com/blackneedle");
	});

	test("an emptied field is stored as null", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		await client
			.put("/t/black-needle/settings/profile")
			.form(form)
			.withCsrfToken()
			.loginAs(owner);

		await client
			.put("/t/black-needle/settings/profile")
			.form({ ...form, intro: "", instagramUrl: "" })
			.withCsrfToken()
			.loginAs(owner);

		const saved = await Tenant.findOrFail(tenant.id);
		assert.isNull(saved.intro);
		assert.isNull(saved.instagramUrl);
	});

	test("an http:// link comes back as a field error", async ({ client }) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.put("/t/black-needle/settings/profile")
			.form({ ...form, instagramUrl: "http://instagram.com/blackneedle" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(
			response,
			"instagramUrl",
			"Enter a full link that starts with https://",
		);
	});

	test("slug, type and tenantId in the body are ignored", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		await client
			.put("/t/black-needle/settings/profile")
			.form({ ...form, slug: "stolen", type: "independent", tenantId: "x" })
			.withCsrfToken()
			.loginAs(owner);

		const saved = await Tenant.findOrFail(tenant.id);
		assert.equal(saved.slug, "black-needle");
		assert.equal(saved.type, "studio");
	});
});
