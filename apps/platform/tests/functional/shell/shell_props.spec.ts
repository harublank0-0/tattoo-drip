import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import type User from "#models/user";
import Tenant from "#modules/tenancy/models/tenant";
import { testImages } from "#tests/helpers/images";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const today = (client: ApiClient, user: User, tenant: { slug: string }) =>
	client.get(`/t/${tenant.slug}/today`).withInertia().loginAs(user);

const setLogo = (
	client: ApiClient,
	user: User,
	tenant: { slug: string },
	data: Buffer,
) =>
	client
		.put(`/t/${tenant.slug}/settings/logo`)
		.file("logo", data, { filename: "logo.png" })
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);

test.group("Shell: the studio identity (Studio OS)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a studio without a logo shares no logo URL", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await today(client, owner, tenant);

		response.assertStatus(200);
		assert.isNull(response.inertiaProps.tenant.logoUrl);
	});

	test("a studio with a logo shares its square icon's URL with every member", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		(
			await setLogo(client, owner, tenant, await testImages.png(600, 200))
		).assertStatus(302);
		const row = await inTenant(tenant, () => Tenant.findOrFail(tenant.id));
		assert.isString(row.logoIconKey);

		for (const user of [owner, artist]) {
			const response = await today(client, user, tenant);
			response.assertStatus(200);
			const { logoUrl } = response.inertiaProps.tenant;
			assert.isString(logoUrl);
			assert.include(logoUrl, `tenants/${tenant.id}/studio_icon/`);
			// The shared tenant names nothing but what the shell draws.
			assert.sameMembers(Object.keys(response.inertiaProps.tenant), [
				"name",
				"slug",
				"type",
				"role",
				// AI Design Lab's nav flag: on in tests (the preview provider).
				"designLab",
				"logoUrl",
			]);
		}
	});
});
