import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { SlugLimitError, SlugTakenError } from "#modules/tenancy/errors";
import Tenant from "#modules/tenancy/models/tenant";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import TenantSlug from "#modules/tenancy/models/tenant_slug";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { MAX_TENANT_SLUGS } from "#modules/tenancy/slugs";
import { dbClient } from "#services/db_context";
import {
	artistIn,
	inTenant,
	inTenantAs,
	inUser,
	studioWithOwner,
} from "#tests/helpers/tenants";

const tenancy = new TenancyService();

/** A rename as the settings request makes it: in the tenant's context. */
function changeSlug(tenant: Tenant, slug: string) {
	return inTenant(tenant, () => tenancy.changeSlug(tenant, slug));
}

async function slugsOf(tenant: Tenant) {
	return inTenant(tenant, async () =>
		(
			await TenantSlug.query().where("tenant_id", tenant.id).orderBy("slug")
		).map(({ slug }) => slug),
	);
}

async function storedSlug(tenant: Tenant) {
	return (await inTenant(tenant, () => Tenant.findOrFail(tenant.id))).slug;
}

test.group("TenancyService.changeSlug", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("moves the tenant and keeps the old slug as its own", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("black-needle");

		const changed = await changeSlug(tenant, "red-ink");

		assert.equal(changed.slug, "red-ink");
		assert.equal(await storedSlug(tenant), "red-ink");
		assert.deepEqual(await slugsOf(tenant), ["black-needle", "red-ink"]);
	});

	test("the same slug changes nothing", async ({ assert }) => {
		const { tenant } = await studioWithOwner("black-needle");

		const changed = await changeSlug(tenant, "black-needle");

		assert.equal(changed.slug, "black-needle");
		assert.deepEqual(await slugsOf(tenant), ["black-needle"]);
	});

	test("another tenant's current slug is SlugTakenError and changes nothing", async ({
		assert,
	}) => {
		const a = await studioWithOwner("studio-a", "Studio A");
		await studioWithOwner("studio-b", "Studio B");

		await assert.rejects(
			() => changeSlug(a.tenant, "studio-b"),
			SlugTakenError,
		);

		assert.equal(await storedSlug(a.tenant), "studio-a");
		assert.deepEqual(await slugsOf(a.tenant), ["studio-a"]);
	});

	test("another tenant's old slug is SlugTakenError and stays theirs", async ({
		assert,
	}) => {
		const a = await studioWithOwner("studio-a", "Studio A");
		const b = await studioWithOwner("studio-b", "Studio B");
		await changeSlug(b.tenant, "studio-b-new");

		await assert.rejects(
			() => changeSlug(a.tenant, "studio-b"),
			SlugTakenError,
		);

		assert.equal(await storedSlug(a.tenant), "studio-a");
		assert.deepEqual(await slugsOf(b.tenant), ["studio-b", "studio-b-new"]);
	});

	test("a member of both studios can't move one onto the other's old slug", async ({
		assert,
	}) => {
		const a = await studioWithOwner("studio-a", "Studio A");
		const b = await studioWithOwner("studio-b", "Studio B");
		await inTenant(b.tenant, () =>
			TenantMembership.create({
				tenantId: b.tenant.id,
				userId: a.owner.id,
				role: "owner",
			}),
		);
		await changeSlug(b.tenant, "studio-b-new");

		// As the member in A: row-level security shows them B's slugs too.
		await assert.rejects(
			() =>
				inTenantAs(a.tenant, a.owner, () =>
					tenancy.changeSlug(a.tenant, "studio-b"),
				),
			SlugTakenError,
		);
		assert.equal(await storedSlug(a.tenant), "studio-a");
	});

	test("a taken slug leaves the surrounding transaction usable", async ({
		assert,
	}) => {
		const a = await studioWithOwner("studio-a", "Studio A");
		await studioWithOwner("studio-b", "Studio B");

		await inTenant(a.tenant, async () => {
			await assert.rejects(
				() => tenancy.changeSlug(a.tenant, "studio-b"),
				SlugTakenError,
			);
			const { rows } = await dbClient().rawQuery(
				"select slug from tenants where id = ?",
				[a.tenant.id],
			);
			assert.deepEqual(rows, [{ slug: "studio-a" }]);
		});
	});

	test("switching back to an old slug reserves nothing new", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("black-needle");
		await changeSlug(tenant, "red-ink");

		await changeSlug(tenant, "black-needle");

		assert.equal(await storedSlug(tenant), "black-needle");
		assert.deepEqual(await slugsOf(tenant), ["black-needle", "red-ink"]);
	});

	test("uses the stored slug, not the caller's copy", async ({ assert }) => {
		const { tenant } = await studioWithOwner("black-needle");
		await changeSlug(tenant, "red-ink");

		// `tenant` still says black-needle; the switch back must happen anyway.
		await changeSlug(tenant, "black-needle");

		assert.equal(await storedSlug(tenant), "black-needle");
	});

	test(`a tenant holds at most ${MAX_TENANT_SLUGS} slugs and can still switch between them`, async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("ink-1");
		for (let n = 2; n <= MAX_TENANT_SLUGS; n++) {
			await changeSlug(tenant, `ink-${n}`);
		}
		assert.lengthOf(await slugsOf(tenant), MAX_TENANT_SLUGS);

		await assert.rejects(() => changeSlug(tenant, "ink-extra"), SlugLimitError);
		assert.equal(await storedSlug(tenant), `ink-${MAX_TENANT_SLUGS}`);
		assert.lengthOf(await slugsOf(tenant), MAX_TENANT_SLUGS);

		await changeSlug(tenant, "ink-1");
		assert.equal(await storedSlug(tenant), "ink-1");
	});
});

test.group("TenancyService.currentSlugFor", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("gives every member the current slug for an old one, along a chain", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("first-ink");
		const artist = await artistIn(tenant);
		await changeSlug(tenant, "second-ink");
		await changeSlug(tenant, "third-ink");

		for (const user of [owner, artist]) {
			for (const old of ["first-ink", "second-ink"]) {
				assert.equal(
					await inUser(user, () => tenancy.currentSlugFor(user, old)),
					"third-ink",
				);
			}
		}
	});

	test("is null for the current slug and for an unknown or differently cased one", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("black-needle");
		await changeSlug(tenant, "red-ink");

		for (const slug of ["red-ink", "no-such-studio", "Black-Needle"]) {
			assert.isNull(
				await inUser(owner, () => tenancy.currentSlugFor(owner, slug)),
				slug,
			);
		}
	});

	test("is null for another tenant's old slug, from any context", async ({
		assert,
	}) => {
		const a = await studioWithOwner("studio-a", "Studio A");
		const b = await studioWithOwner("studio-b", "Studio B");
		await changeSlug(a.tenant, "studio-a-new");

		assert.isNull(
			await inUser(b.owner, () => tenancy.currentSlugFor(b.owner, "studio-a")),
		);
		assert.isNull(
			await inTenantAs(b.tenant, b.owner, () =>
				tenancy.currentSlugFor(b.owner, "studio-a"),
			),
		);
	});

	test("is null for a removed member", async ({ assert }) => {
		const { tenant } = await studioWithOwner("black-needle");
		const artist = await artistIn(tenant);
		await changeSlug(tenant, "red-ink");
		await inTenant(tenant, async () => {
			const membership = await TenantMembership.query()
				.where("tenant_id", tenant.id)
				.where("user_id", artist.id)
				.firstOrFail();
			await membership.softDelete();
		});

		assert.isNull(
			await inUser(artist, () =>
				tenancy.currentSlugFor(artist, "black-needle"),
			),
		);
	});

	test("is null for a deleted tenant whose membership is still live", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("black-needle");
		await changeSlug(tenant, "red-ink");
		await inTenant(tenant, () =>
			dbClient().rawQuery(
				"update tenants set deleted_at = now() where id = ?",
				[tenant.id],
			),
		);

		assert.isNull(
			await inUser(owner, () => tenancy.currentSlugFor(owner, "black-needle")),
		);
	});
});
