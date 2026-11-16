import testUtils from "@adonisjs/core/services/test_utils";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { test } from "@japa/runner";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import { dbClient, withTransaction } from "#services/db_context";
import { addArtist, artistInput } from "#tests/helpers/artists";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Archiving artists (studio packages, phase 2): an archived artist keeps
 * their history, is never shown and doesn't count toward the package's
 * active-artist limit; a hidden artist still counts.
 */
test.group("Artists: archiving", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const artists = new ArtistService(new ImageService());

	test("archiving keeps the artist, hides them and stops counting them", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("arch-a", "Arch A");
		const a = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
		const b = await addArtist(tenant, owner, { name: "Bina", slug: "bina" });

		await inTenant(tenant, async () => {
			assert.equal(await artists.countActive(tenant), 2);
			const archived = await artists.archive(tenant, b.id);
			assert.isNotNull(archived.archivedAt);
			assert.isFalse(archived.visible);
			assert.sameMembers(
				(await artists.list(tenant)).map(({ id }) => id),
				[a.id, b.id],
			);
			assert.deepEqual(
				(await artists.listAssignable(tenant)).map(({ id }) => id),
				[a.id],
			);
			assert.isNull(await artists.findAssignable(tenant, b.id));
			assert.equal((await artists.findAssignable(tenant, a.id))?.id, a.id);
			assert.equal(await artists.countActive(tenant), 1);
			// Archiving again changes nothing.
			const again = await artists.archive(tenant, b.id);
			assert.equal(
				again.archivedAt?.toMillis(),
				archived.archivedAt?.toMillis(),
			);
		});
	});

	test("an archived artist can't be shown, by the form or directly", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("arch-b", "Arch B");
		const b = await addArtist(tenant, owner, { name: "Bina", slug: "bina" });

		await inTenant(tenant, async () => {
			const archived = await artists.archive(tenant, b.id);
			const saved = await artists.update(
				tenant,
				archived,
				artistInput({ name: "Bina", slug: "bina", visible: true }),
				owner,
			);
			assert.isFalse(saved.visible);
			assert.isNotNull(saved.archivedAt);
			await assert.rejects(
				() =>
					withTransaction((trx) =>
						trx.rawQuery("update artists set visible = true where id = ?", [
							b.id,
						]),
					),
				/artists_archived_hidden/,
			);
		});
	});

	test("restoring leaves the artist hidden and counts them again", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("arch-c", "Arch C");
		await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
		const b = await addArtist(tenant, owner, { name: "Bina", slug: "bina" });

		await inTenant(tenant, async () => {
			await artists.archive(tenant, b.id);
			const restored = await artists.restore(tenant, b.id);
			assert.isNull(restored.archivedAt);
			assert.isFalse(restored.visible);
			assert.equal(await artists.countActive(tenant), 2);
		});
	});

	test("a deleted artist never counts; a hidden one does", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("arch-d", "Arch D");
		const a = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
		await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		const c = await addArtist(tenant, owner, { name: "Chet", slug: "chet" });

		await inTenant(tenant, async () => {
			await artists.update(
				tenant,
				a,
				artistInput({ name: "Asha", slug: "asha", visible: false }),
				owner,
			);
			assert.equal(await artists.countActive(tenant), 3);
			await artists.delete(tenant, c);
			assert.equal(await artists.countActive(tenant), 2);
			const { rows } = await dbClient().rawQuery(
				"select count(*)::int as n from artists where tenant_id = ? and deleted_at is null and archived_at is null",
				[tenant.id],
			);
			assert.equal(rows[0].n, 2);
		});
	});

	test("another studio's artist is unknown", async ({ assert }) => {
		const { tenant, owner } = await studioWithOwner("arch-e", "Arch E");
		const { tenant: other } = await studioWithOwner("arch-f", "Arch F");
		const a = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });

		await inTenant(other, async () => {
			await assert.rejects(
				() => artists.archive(other, a.id),
				lucidErrors.E_ROW_NOT_FOUND,
			);
			await assert.rejects(
				() => artists.restore(other, a.id),
				lucidErrors.E_ROW_NOT_FOUND,
			);
		});
		await inTenant(tenant, async () => {
			assert.isNull((await artists.findFor(tenant, a.id)).archivedAt);
		});
	});
});
