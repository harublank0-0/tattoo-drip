import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const tenancy = new TenancyService();

function changeSlug(tenant: Tenant, slug: string) {
	return inTenant(tenant, () => tenancy.changeSlug(tenant, slug));
}

test.group("Old slugs on the dashboard", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a page under an old slug redirects to the same page under the current one, query kept", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner("black-needle");
		await changeSlug(tenant, "red-ink");

		const response = await client
			.get("/t/black-needle/projects?status=closed")
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/t/red-ink/projects?status=closed");
	});

	test("the bare old address redirects, and the new address opens", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner("black-needle");
		await changeSlug(tenant, "red-ink");

		const old = await client.get("/t/black-needle").loginAs(owner).redirects(0);
		old.assertStatus(302);
		old.assertHeader("location", "/t/red-ink");

		const current = await client
			.get("/t/red-ink/settings/profile")
			.loginAs(owner);
		current.assertStatus(200);
	});

	test("an artist member is redirected too", async ({ client }) => {
		const { tenant } = await studioWithOwner("black-needle");
		const artist = await artistIn(tenant);
		await changeSlug(tenant, "red-ink");

		const response = await client
			.get("/t/black-needle/projects")
			.loginAs(artist)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/t/red-ink/projects");
	});

	test("the first slug of a chain goes straight to the current one", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner("first-ink");
		await changeSlug(tenant, "second-ink");
		await changeSlug(tenant, "third-ink");

		const response = await client
			.get("/t/first-ink/inbox")
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/t/third-ink/inbox");
	});

	test("HEAD redirects like GET", async ({ client }) => {
		const { owner, tenant } = await studioWithOwner("black-needle");
		await changeSlug(tenant, "red-ink");

		const response = await client
			.head("/t/black-needle/settings/profile")
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/t/red-ink/settings/profile");
	});

	test("a write under an old slug is a 404 and changes nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("black-needle");
		await changeSlug(tenant, "red-ink");

		const response = await client
			.put("/t/black-needle/settings/profile")
			.form({ name: "Hijacked", timezone: "Asia/Kathmandu" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(404);
		assert.equal(
			(await inTenant(tenant, () => Tenant.findOrFail(tenant.id))).name,
			"Black Needle",
		);
	});

	test("another studio's old slug is a 404, not a redirect", async ({
		client,
	}) => {
		const a = await studioWithOwner("studio-a", "Studio A");
		const b = await studioWithOwner("studio-b", "Studio B");
		await changeSlug(a.tenant, "studio-a-new");

		const response = await client
			.get("/t/studio-a/settings/profile")
			.loginAs(b.owner)
			.redirects(0);

		response.assertStatus(404);
	});

	test("a deleted studio's old slug is a 404", async ({ client }) => {
		const { owner, tenant } = await studioWithOwner("black-needle");
		await changeSlug(tenant, "red-ink");
		await inTenant(tenant, () =>
			dbClient().rawQuery(
				"update tenants set deleted_at = now() where id = ?",
				[tenant.id],
			),
		);

		const response = await client
			.get("/t/black-needle")
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(404);
	});

	test("an old slug in different case is a 404", async ({ client }) => {
		const { owner, tenant } = await studioWithOwner("black-needle");
		await changeSlug(tenant, "red-ink");

		const response = await client
			.get("/t/Black-Needle")
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(404);
	});
});
