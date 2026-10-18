import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import {
	ArtistProfileExistsError,
	ArtistSlugTakenError,
} from "#modules/artists/errors";
import Artist from "#modules/artists/models/artist";
import ArtistService, {
	type ArtistInput,
} from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import { dbClient, withDbContext } from "#services/db_context";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const artists = new ArtistService(new ImageService());

const input = (over: Partial<ArtistInput> = {}): ArtistInput => ({
	name: "Sita Rai",
	slug: "sita",
	bio: null,
	visible: true,
	acceptingInquiries: true,
	closedMessage: null,
	linkToMe: false,
	...over,
});

const names = (list: Artist[]) => list.map(({ name }) => name);

test.group("ArtistService profiles", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("create stores the profile, unlinked by default", async ({ assert }) => {
		const { tenant, owner } = await studioWithOwner();

		const artist = await inTenant(tenant, () =>
			artists.create(tenant, input({ bio: "Fine line work" }), owner),
		);

		assert.equal(artist.tenantId, tenant.id);
		assert.equal(artist.name, "Sita Rai");
		assert.equal(artist.slug, "sita");
		assert.equal(artist.bio, "Fine line work");
		assert.isTrue(artist.visible);
		assert.isTrue(artist.acceptingInquiries);
		assert.isNull(artist.userId);
		assert.isNull(artist.photoKey);
	});

	test("linkToMe links the profile to the acting member", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		const artist = await inTenant(tenant, () =>
			artists.create(tenant, input({ linkToMe: true }), owner),
		);

		assert.equal(artist.userId, owner.id);
	});

	test("a second profile for the same member is refused, and the request stays usable", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async () => {
			await artists.create(tenant, input({ linkToMe: true }), owner);
			await assert.rejects(
				() =>
					artists.create(
						tenant,
						input({ slug: "second", linkToMe: true }),
						owner,
					),
				ArtistProfileExistsError,
			);
			const { rows } = await dbClient().rawQuery("select 1 as ok");
			assert.equal(rows[0].ok, 1);
		});
	});

	test("a taken slug is refused, the request stays usable, and a deleted profile frees its slug", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async () => {
			const first = await artists.create(tenant, input(), owner);
			await assert.rejects(
				() => artists.create(tenant, input({ name: "Other" }), owner),
				ArtistSlugTakenError,
			);
			assert.deepEqual(names(await artists.list(tenant)), ["Sita Rai"]);

			await artists.delete(tenant, await artists.findFor(tenant, first.id));
			await artists.create(tenant, input({ name: "Again" }), owner);
			assert.deepEqual(names(await artists.list(tenant)), ["Again"]);
		});
	});

	test("two tenants can use the same slug", async () => {
		const { tenant: a, owner: ownerA } = await studioWithOwner(
			"studio-a",
			"Studio A",
		);
		const { tenant: b, owner: ownerB } = await studioWithOwner(
			"studio-b",
			"Studio B",
		);

		await inTenant(a, () => artists.create(a, input(), ownerA));
		await inTenant(b, () => artists.create(b, input(), ownerB));
	});

	test("update changes the profile and refuses a slug another artist uses", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const first = await inTenant(tenant, () =>
			artists.create(tenant, input(), owner),
		);
		await inTenant(tenant, () =>
			artists.create(tenant, input({ name: "Bea", slug: "bea" }), owner),
		);

		await inTenant(tenant, async () => {
			const saved = await artists.update(
				tenant,
				first,
				input({
					name: "Sita R.",
					slug: "sita-r",
					bio: "New bio",
					visible: false,
					acceptingInquiries: false,
					closedMessage: "Back in May",
				}),
				owner,
			);
			assert.equal(saved.name, "Sita R.");
			assert.equal(saved.slug, "sita-r");
			assert.equal(saved.bio, "New bio");
			assert.isFalse(saved.visible);
			assert.isFalse(saved.acceptingInquiries);
			assert.equal(saved.closedMessage, "Back in May");

			await assert.rejects(
				() => artists.update(tenant, first, input({ slug: "bea" }), owner),
				ArtistSlugTakenError,
			);
			assert.equal((await artists.findFor(tenant, first.id)).slug, "sita-r");
		});
	});

	test("unchecking 'this is my profile' unlinks only the acting member", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const mine = await inTenant(tenant, () =>
			artists.create(tenant, input({ linkToMe: true }), owner),
		);

		const unlinked = await inTenant(tenant, () =>
			artists.update(tenant, mine, input({ linkToMe: false }), owner),
		);

		assert.isNull(unlinked.userId);
	});

	test("an edit with linkToMe links an unlinked profile to the acting member", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const unlinked = await inTenant(tenant, () =>
			artists.create(tenant, input(), owner),
		);
		assert.isNull(unlinked.userId);

		await inTenant(tenant, async () => {
			const linked = await artists.update(
				tenant,
				unlinked,
				input({ linkToMe: true }),
				owner,
			);
			assert.equal(linked.userId, owner.id);

			const fresh = await artists.findFor(tenant, unlinked.id);
			assert.equal(fresh.userId, owner.id);
		});
	});

	test("linking a second profile on edit is refused, leaves it unlinked, and the request stays usable", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async () => {
			const mine = await artists.create(
				tenant,
				input({ linkToMe: true }),
				owner,
			);
			const loose = await artists.create(
				tenant,
				input({ name: "Loose", slug: "loose" }),
				owner,
			);

			await assert.rejects(
				() =>
					artists.update(
						tenant,
						loose,
						input({ name: "Changed", slug: "changed", linkToMe: true }),
						owner,
					),
				ArtistProfileExistsError,
			);

			const fresh = await artists.findFor(tenant, loose.id);
			assert.isNull(fresh.userId);
			assert.equal(fresh.name, "Loose");
			assert.equal(fresh.slug, "loose");
			assert.equal((await artists.findFor(tenant, mine.id)).userId, owner.id);
			const { rows } = await dbClient().rawQuery("select 1 as ok");
			assert.equal(rows[0].ok, 1);
		});
	});

	test("linkToMe never takes over, and an edit never unlinks, another user's profile", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const other = await User.create({
			email: "other@example.com",
			password: "secret-password",
		});
		const artist = await inTenant(tenant, async () => {
			const created = await artists.create(tenant, input(), owner);
			await Artist.query()
				.where("id", created.id)
				.update({ user_id: other.id });
			return created;
		});

		await inTenant(tenant, async () => {
			const claimed = await artists.update(
				tenant,
				artist,
				input({ linkToMe: true }),
				owner,
			);
			assert.equal(claimed.userId, other.id);
			const edited = await artists.update(
				tenant,
				artist,
				input({ linkToMe: false }),
				owner,
			);
			assert.equal(edited.userId, other.id);
		});
	});

	test("list is ordered by name, ignoring case", async ({ assert }) => {
		const { tenant, owner } = await studioWithOwner();
		await inTenant(tenant, async () => {
			await artists.create(tenant, input({ name: "bea", slug: "bea" }), owner);
			await artists.create(tenant, input({ name: "Ada", slug: "ada" }), owner);
			await artists.create(
				tenant,
				input({ name: "Carl", slug: "carl" }),
				owner,
			);

			assert.deepEqual(names(await artists.list(tenant)), [
				"Ada",
				"bea",
				"Carl",
			]);
		});
	});

	test("delete is a soft delete: the profile leaves the list and findFor", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const artist = await inTenant(tenant, () =>
			artists.create(tenant, input(), owner),
		);

		await inTenant(tenant, () => artists.delete(tenant, artist));

		await inTenant(tenant, async () => {
			assert.lengthOf(await artists.list(tenant), 0);
			await assert.rejects(
				() => artists.findFor(tenant, artist.id),
				/Row not found/,
			);
			assert.lengthOf(
				await Artist.onlyTrashed().where("tenant_id", tenant.id),
				1,
			);
		});
	});

	test("list and findFor only see the tenant's own live artists", async ({
		assert,
	}) => {
		const { tenant: a, owner: ownerA } = await studioWithOwner(
			"studio-a",
			"Studio A",
		);
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		const mine = await inTenant(a, () => artists.create(a, input(), ownerA));

		// A's context lets row-level security show A's row, so only the
		// service's own tenant filter can hide it from B's lookups.
		await withDbContext({ tenantId: a.id }, async () => {
			await assert.rejects(() => artists.findFor(b, mine.id), /Row not found/);
			assert.lengthOf(await artists.list(b), 0);
			assert.lengthOf(await artists.list(a), 1);
		});
	});

	test("update and delete refuse another tenant's artist and leave it unchanged", async ({
		assert,
	}) => {
		const { tenant: a, owner: ownerA } = await studioWithOwner(
			"studio-a",
			"Studio A",
		);
		const { tenant: b, owner: ownerB } = await studioWithOwner(
			"studio-b",
			"Studio B",
		);
		const mine = await inTenant(a, () => artists.create(a, input(), ownerA));

		// A's context lets row-level security show and change A's row, so only
		// the service's own tenant check can refuse B's calls.
		await withDbContext({ tenantId: a.id }, async () => {
			await assert.rejects(
				() => artists.update(b, mine, input({ name: "Hijacked" }), ownerB),
				/belongs to another tenant/,
			);
			await assert.rejects(
				() => artists.delete(b, mine),
				/belongs to another tenant/,
			);

			const row = await Artist.withTrashed().where("id", mine.id).firstOrFail();
			assert.equal(row.name, "Sita Rai");
			assert.equal(row.slug, "sita");
			assert.isNull(row.deletedAt);
		});
	});

	test("update's row lock only finds the tenant's own artist", async ({
		assert,
	}) => {
		const { tenant: a, owner: ownerA } = await studioWithOwner(
			"studio-a",
			"Studio A",
		);
		const { tenant: b, owner: ownerB } = await studioWithOwner(
			"studio-b",
			"Studio B",
		);
		const mine = await inTenant(a, () => artists.create(a, input(), ownerA));

		await withDbContext({ tenantId: a.id }, async () => {
			// A's row, but claiming to be B's: the ownership check passes, so
			// only the tenant filter on the locked query can refuse the update.
			const forged = await Artist.findOrFail(mine.id);
			forged.tenantId = b.id;

			await assert.rejects(
				() => artists.update(b, forged, input({ name: "Hijacked" }), ownerB),
				/Row not found/,
			);

			const row = await Artist.withTrashed().where("id", mine.id).firstOrFail();
			assert.equal(row.tenantId, a.id);
			assert.equal(row.name, "Sita Rai");
			assert.equal(row.slug, "sita");
			assert.isNull(row.deletedAt);
		});
	});

	test("create cannot add an artist to another tenant", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b, owner: ownerB } = await studioWithOwner(
			"studio-b",
			"Studio B",
		);

		// The insert says tenant B while the session is tenant A: only
		// row-level security can refuse it.
		await withDbContext({ tenantId: a.id }, async () => {
			await assert.rejects(
				() => artists.create(b, input(), ownerB),
				/row-level security/,
			);
			assert.lengthOf(await artists.list(a), 0);
		});

		assert.lengthOf(await inTenant(b, () => artists.list(b)), 0);
	});

	test("createOwnerProfile makes a visible, accepting profile from the tenant's name and slug", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		const artist = await inTenant(tenant, () =>
			artists.createOwnerProfile(tenant, owner),
		);

		assert.equal(artist.name, tenant.name);
		assert.equal(artist.slug, tenant.slug);
		assert.equal(artist.userId, owner.id);
		assert.isTrue(artist.visible);
		assert.isTrue(artist.acceptingInquiries);
	});
});

test.group("ArtistService.listVisible", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists the live, visible profiles by name, closed ones included", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("visible-needle-51");

		const listed = await inTenant(tenant, async () => {
			await Artist.create({
				tenantId: tenant.id,
				name: "zara",
				slug: "zara",
				acceptingInquiries: false,
			});
			await Artist.create({ tenantId: tenant.id, name: "Bina", slug: "bina" });
			await Artist.create({
				tenantId: tenant.id,
				name: "Hidden",
				slug: "hidden",
				visible: false,
			});
			const gone = await Artist.create({
				tenantId: tenant.id,
				name: "Gone",
				slug: "gone",
			});
			await gone.softDelete();
			return names(await artists.listVisible(tenant));
		});

		assert.deepEqual(listed, ["Bina", "zara"]);
	});

	test("another studio's context sees none of them", async ({ assert }) => {
		const { tenant } = await studioWithOwner("visible-a-51");
		const other = await studioWithOwner("visible-b-51");
		await inTenant(tenant, () =>
			Artist.create({ tenantId: tenant.id, name: "Bina", slug: "bina" }),
		);

		assert.lengthOf(
			await inTenant(other.tenant, () => artists.listVisible(tenant)),
			0,
		);
	});
});

test.group("ArtistService.findVisibleBySlug", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("finds a live, visible profile by its exact slug, open or closed", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("slug-needle-44");

		const found = await inTenant(tenant, async () => {
			await Artist.create({
				tenantId: tenant.id,
				name: "Zara",
				slug: "zara",
				acceptingInquiries: false,
			});
			return artists.findVisibleBySlug(tenant, "zara");
		});

		assert.equal(found?.name, "Zara");
	});

	test("a hidden, deleted, unknown or differently cased slug is null", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("slug-missing-44");

		const results = await inTenant(tenant, async () => {
			await Artist.create({ tenantId: tenant.id, name: "Bina", slug: "bina" });
			await Artist.create({
				tenantId: tenant.id,
				name: "Hidden",
				slug: "hidden",
				visible: false,
			});
			const gone = await Artist.create({
				tenantId: tenant.id,
				name: "Gone",
				slug: "gone",
			});
			await gone.softDelete();
			const found: (Artist | null)[] = [];
			for (const slug of ["hidden", "gone", "nobody", "Bina", "bina "]) {
				found.push(await artists.findVisibleBySlug(tenant, slug));
			}
			return found;
		});

		assert.deepEqual(results, [null, null, null, null, null]);
	});

	test("filters by the tenant it is given, not only by row-level security", async ({
		assert,
	}) => {
		const a = await studioWithOwner("slug-a-44");
		const b = await studioWithOwner("slug-b-44");
		await inTenant(b.tenant, () =>
			Artist.create({ tenantId: b.tenant.id, name: "Only B", slug: "only-b" }),
		);

		// In B's context RLS would show B's row: only the tenant filter hides it.
		assert.isNull(
			await inTenant(b.tenant, () =>
				artists.findVisibleBySlug(a.tenant, "only-b"),
			),
		);
		assert.isNull(
			await inTenant(a.tenant, () =>
				artists.findVisibleBySlug(a.tenant, "only-b"),
			),
		);
	});
});
