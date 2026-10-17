import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Tenant from "#modules/tenancy/models/tenant";
import TenantSlug from "#modules/tenancy/models/tenant_slug";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { MAX_TENANT_SLUGS } from "#modules/tenancy/slugs";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const tenancy = new TenancyService();
const FORMAT =
	"Use 3 to 63 lowercase letters, numbers and single hyphens, with at least one letter. Don't start or end with a hyphen.";
const RESERVED = "This address is reserved. Try another one.";
const TAKEN = "This address is already taken. Try another one.";

/** The stored slug and every slug the tenant holds. */
function stored(tenant: Tenant) {
	return inTenant(tenant, async () => ({
		slug: (await Tenant.findOrFail(tenant.id)).slug,
		slugs: (
			await TenantSlug.query().where("tenant_id", tenant.id).orderBy("slug")
		).map(({ slug }) => slug),
	}));
}

test.group("Changing the web address", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner changes it and lands on the profile page under the new address", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("black-needle");

		const response = await client
			.put("/t/black-needle/settings/slug")
			.form({ slug: " Red-Ink " })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/t/red-ink/settings/profile");
		response.assertFlashMessage(
			"success",
			"Address changed. Links to the old address still work.",
		);
		assert.deepEqual(await stored(tenant), {
			slug: "red-ink",
			slugs: ["black-needle", "red-ink"],
		});

		const old = await client
			.get("/t/black-needle/settings/profile")
			.loginAs(owner)
			.redirects(0);
		old.assertHeader("location", "/t/red-ink/settings/profile");
	});

	test("the same address, typed in capitals, changes nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("black-needle");

		const response = await client
			.put("/t/black-needle/settings/slug")
			.form({ slug: "Black-Needle" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/t/black-needle/settings/profile");
		assert.deepEqual(await stored(tenant), {
			slug: "black-needle",
			slugs: ["black-needle"],
		});
	});

	for (const [slug, message] of [
		["www", "This address is reserved. Try another one."],
		["black--ink", FORMAT],
		["12345", FORMAT],
	] as const) {
		test(`refuses "${slug}"`, async ({ client, assert }) => {
			const { owner, tenant } = await studioWithOwner("black-needle");

			const response = await client
				.put("/t/black-needle/settings/slug")
				.form({ slug })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

			assertValidationError(response, "slug", message);
			assert.equal((await stored(tenant)).slug, "black-needle");
		});
	}

	test("another studio's current or old address is taken", async ({
		client,
		assert,
	}) => {
		const a = await studioWithOwner("studio-a", "Studio A");
		const b = await studioWithOwner("studio-b", "Studio B");
		await inTenant(b.tenant, () =>
			tenancy.changeSlug(b.tenant, "studio-b-new"),
		);

		for (const slug of ["studio-b-new", "studio-b"]) {
			const response = await client
				.put("/t/studio-a/settings/slug")
				.form({ slug })
				.withCsrfToken()
				.loginAs(a.owner)
				.redirects(0);
			assertValidationError(response, "slug", TAKEN);
		}
		assert.deepEqual(await stored(a.tenant), {
			slug: "studio-a",
			slugs: ["studio-a"],
		});
	});

	test(`after ${MAX_TENANT_SLUGS} addresses a new one is refused`, async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("ink-1");
		for (let n = 2; n <= MAX_TENANT_SLUGS; n++) {
			await inTenant(tenant, () => tenancy.changeSlug(tenant, `ink-${n}`));
		}

		const response = await client
			.put(`/t/ink-${MAX_TENANT_SLUGS}/settings/slug`)
			.form({ slug: "ink-extra" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(
			response,
			"slug",
			`Your studio has used ${MAX_TENANT_SLUGS} addresses, the most allowed. You can still switch back to an earlier one.`,
		);
		assert.equal((await stored(tenant)).slug, `ink-${MAX_TENANT_SLUGS}`);
	});

	// Ruling 4 keeps slugs from before the rules; ruling 8 lets an owner switch
	// back to an own old slug only if it still passes them, because a reserved
	// name must not come back through Settings.
	for (const [slug, message] of [
		["a--b", FORMAT],
		["12345", FORMAT],
		["www", RESERVED],
	] as const) {
		test(`a kept "${slug}" still redirects but can't be switched back to`, async ({
			client,
			assert,
		}) => {
			const { owner, tenant } = await studioWithOwner(slug);
			await inTenant(tenant, () => tenancy.changeSlug(tenant, "ab-studio"));

			const old = await client
				.get(`/t/${slug}/settings/profile`)
				.loginAs(owner)
				.redirects(0);
			old.assertStatus(302);
			old.assertHeader("location", "/t/ab-studio/settings/profile");

			const response = await client
				.put("/t/ab-studio/settings/slug")
				.form({ slug })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

			assertValidationError(response, "slug", message);
			assert.deepEqual(await stored(tenant), {
				slug: "ab-studio",
				slugs: [slug, "ab-studio"].sort(),
			});
		});
	}

	test("an artist gets 404 and the address stays", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("black-needle");
		const artist = await artistIn(tenant);

		const response = await client
			.put("/t/black-needle/settings/slug")
			.form({ slug: "red-ink" })
			.withCsrfToken()
			.loginAs(artist)
			.redirects(0);

		response.assertStatus(404);
		assert.equal((await stored(tenant)).slug, "black-needle");
	});
});
