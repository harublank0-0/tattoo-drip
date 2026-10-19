import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { inUser, studioWithOwner } from "#tests/helpers/tenants";

const PASSWORD = "secret-password";

const studio = {
	name: "Gate Studio",
	type: "studio",
	slug: "gate-studio-18",
	timezone: "Asia/Kathmandu",
};

function createTenant(client: ApiClient, user: User) {
	return client
		.post("/onboarding")
		.form(studio)
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);
}

test.group("The confirmed-email gate (TAT-18)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an unconfirmed account can't open onboarding or create a tenant", async ({
		client,
		assert,
	}) => {
		const user = await User.create({
			email: "new@gate-18.example",
			password: PASSWORD,
		});

		(await client.get("/onboarding").loginAs(user).redirects(0)).assertHeader(
			"location",
			"/confirm-email",
		);
		(await createTenant(client, user)).assertHeader(
			"location",
			"/confirm-email",
		);

		assert.isFalse(
			await inUser(user, () => new TenancyService().hasTenant(user)),
		);
	});

	test("a confirmed account creates its tenant", async ({ client, assert }) => {
		const user = await User.create({
			email: "confirmed@gate-18.example",
			password: PASSWORD,
			emailVerifiedAt: DateTime.now(),
		});

		(await client.get("/onboarding").loginAs(user).redirects(0)).assertStatus(
			200,
		);
		(await createTenant(client, user)).assertHeader("location", "/dashboard");

		assert.isTrue(
			await inUser(user, () => new TenancyService().hasTenant(user)),
		);
	});

	test("an unconfirmed member keeps every studio page, and the shared prop says so", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner("gate-studio-18", "Gate Studio");

		const inbox = await client
			.get("/t/gate-studio-18/inbox")
			.withInertia()
			.loginAs(owner);
		inbox.assertStatus(200);
		assert.isFalse(inbox.inertiaProps.user.emailVerified);

		owner.emailVerifiedAt = DateTime.now();
		await owner.save();
		const after = await client
			.get("/t/gate-studio-18/inbox")
			.withInertia()
			.loginAs(await User.findOrFail(owner.id));
		assert.isTrue(after.inertiaProps.user.emailVerified);
	});
});
