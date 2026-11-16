import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { adminUser } from "#tests/helpers/admin";
import { studioWithOwner } from "#tests/helpers/tenants";

test.group("Admin shell", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("GET /admin sends the admin to Studios and anyone else to a 404", async ({
		client,
	}) => {
		const { owner } = await studioWithOwner("adm-shell", "Shell Ink");
		const admin = await adminUser();
		(await client.get("/admin").loginAs(owner)).assertStatus(404);
		const redirect = await client.get("/admin").loginAs(admin).redirects(0);
		redirect.assertStatus(302);
		redirect.assertHeader("location", "/admin/studios");
	});

	test("only the admin's pages carry platformAdmin: true", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("adm-flag", "Flag Ink");
		const page = await client
			.get(`/t/${tenant.slug}/today`)
			.loginAs(owner)
			.withInertia();
		assert.isFalse(page.inertiaProps.platformAdmin);
		const adminPage = await client
			.get("/admin/billing")
			.loginAs(await adminUser())
			.withInertia();
		assert.isTrue(adminPage.inertiaProps.platformAdmin);
	});
});
