import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import Artist from "#modules/artists/models/artist";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import { bulkSummary } from "#modules/artists/portfolio";
import WorkPhotoService from "#modules/artists/services/work_photo_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { addArtist, addWorkPhoto } from "#tests/helpers/artists";
import { failDeletes } from "#tests/helpers/storage_failures";
import {
	artistIn,
	inTenant,
	inTenantAs,
	studioWithOwner,
} from "#tests/helpers/tenants";

const at = (minutes: number) => DateTime.now().minus({ minutes });

/**
 * A studio with Sita (shown) and Hari (hidden, linked to an artist
 * member), and three photos: Sita's koi (published, blackwork), Sita's
 * rose (unpublished, fine-line only) and Hari's mandala (published).
 */
async function studio(slug: string) {
	const { tenant, owner } = await studioWithOwner(slug, `Studio ${slug}`);
	const sita = await addArtist(tenant, owner, {
		name: "Sita Rai",
		slug: "sita",
	});
	const hari = await addArtist(tenant, owner, {
		name: "Hari Thapa",
		slug: "hari",
		visible: false,
	});
	const member = await artistIn(tenant, `artist@${slug}.example`);
	const rows = await inTenant(tenant, async () => {
		await Artist.query().where("id", hari.id).update({ user_id: member.id });
		return {
			koi: await addWorkPhoto(tenant, sita, {
				styles: ["blackwork"],
				createdAt: at(30),
			}),
			rose: await addWorkPhoto(tenant, sita, {
				styles: ["fine-line"],
				hidden: true,
				createdAt: at(20),
			}),
			mandala: await addWorkPhoto(tenant, hari, { createdAt: at(10) }),
		};
	});
	return { tenant, owner, sita, hari, member, ...rows };
}

const bulk = (
	client: ApiClient,
	tenant: Tenant,
	user: User,
	body: Record<string, unknown>,
) =>
	client
		.post(`/t/${tenant.slug}/portfolio/bulk`)
		.json({ back: `/t/${tenant.slug}/portfolio?status=unpublished`, ...body })
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);

const row = (tenant: Tenant, id: string) =>
	inTenant(tenant, () => ArtistWorkPhoto.find(id));

const flashOf = (response: { flashMessage(key: string): unknown }) => ({
	success: response.flashMessage("success") as string | undefined,
	error: response.flashMessage("error") as string | undefined,
});

test.group("Portfolio publishing (Studio OS)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("each photo's status is on the page, unpublished or artist hidden, and the filter follows it", async ({
		client,
		assert,
	}) => {
		const s = await studio("pub-status");
		const of = async (query: string) => {
			const response = await client
				.get(`/t/pub-status/portfolio${query}`)
				.withInertia()
				.loginAs(s.owner);
			return response.inertiaProps as {
				photos: {
					id: string;
					published: boolean;
					shown: boolean;
					pageUrl: string | null;
				}[];
				storefront: { galleryUrl: string };
			};
		};
		const all = await of("");
		const byId = Object.fromEntries(
			all.photos.map((photo) => [photo.id, photo]),
		);
		assert.deepInclude(byId[s.koi.id], { published: true, shown: true });
		assert.match(
			byId[s.koi.id].pageUrl ?? "",
			new RegExp(`/gallery/${s.koi.id}$`),
		);
		assert.deepInclude(byId[s.rose.id], {
			published: false,
			shown: false,
			pageUrl: null,
		});
		assert.deepInclude(byId[s.mandala.id], {
			published: true,
			shown: false,
			pageUrl: null,
		});
		assert.match(all.storefront.galleryUrl, /\/gallery$/);

		const ids = async (query: string) =>
			(await of(query)).photos.map(({ id }) => id);
		assert.deepEqual(await ids("?status=published"), [s.koi.id]);
		assert.deepEqual(await ids("?status=unpublished"), [s.rose.id]);
		assert.deepEqual(await ids("?status=artist_hidden"), [s.mandala.id]);
	});

	test("an unpublished photo is in no public read: the gallery, its page, its filters or an artist's photos", async ({
		client,
		assert,
	}) => {
		const s = await studio("pub-public");
		const work = await client.get("/api/v1/tenants/pub-public/work");
		work.assertStatus(200);
		const body = work.body() as {
			data: { id: string }[];
			filters: { styles: { slug: string }[] };
		};
		assert.deepEqual(
			body.data.map(({ id }) => id),
			[s.koi.id],
		);
		// Only the unpublished rose carries fine-line: the filter doesn't offer it.
		assert.deepEqual(
			body.filters.styles.map(({ slug }) => slug),
			["blackwork"],
		);

		(
			await client.get(`/api/v1/tenants/pub-public/work/${s.rose.id}`)
		).assertStatus(404);
		(
			await client.get(`/api/v1/tenants/pub-public/work/${s.koi.id}`)
		).assertStatus(200);

		const artist = await client.get("/api/v1/tenants/pub-public/artists/sita");
		const { data } = artist.body() as {
			data: { workPhotos: { url: string }[] };
		};
		const photos = data.workPhotos;
		assert.lengthOf(photos, 1);
		assert.include(photos[0].url, s.koi.imageKey.replace(/\.[^/]+$/, ""));
	});

	test("publishing and unpublishing go through the public reads at once", async ({
		client,
		assert,
	}) => {
		const s = await studio("pub-flip");
		const published = await bulk(client, s.tenant, s.owner, {
			action: "publish",
			ids: [s.rose.id],
		});
		published.assertStatus(302);
		published.assertHeader(
			"location",
			"/t/pub-flip/portfolio?status=unpublished",
		);
		assert.equal(flashOf(published).success, "1 photo published.");
		(
			await client.get(`/api/v1/tenants/pub-flip/work/${s.rose.id}`)
		).assertStatus(200);

		const unpublished = await bulk(client, s.tenant, s.owner, {
			action: "unpublish",
			ids: [s.koi.id, s.rose.id],
		});
		assert.equal(flashOf(unpublished).success, "2 photos unpublished.");
		const work = await client.get("/api/v1/tenants/pub-flip/work");
		assert.deepEqual((work.body() as { data: unknown[] }).data, []);
		(
			await client.get(`/api/v1/tenants/pub-flip/work/${s.koi.id}`)
		).assertStatus(404);
	});

	test("a bulk change checks every photo: another studio's ids are counted and left alone", async ({
		client,
		assert,
	}) => {
		const a = await studio("pub-iso-a");
		const b = await studio("pub-iso-b");
		const response = await bulk(client, a.tenant, a.owner, {
			action: "unpublish",
			ids: [a.koi.id, b.koi.id],
		});
		response.assertStatus(302);
		assert.equal(
			flashOf(response).error,
			"1 photo unpublished. Not changed: 1 photo removed or changed meanwhile.",
		);
		assert.isTrue((await row(a.tenant, a.koi.id))?.hidden);
		assert.isFalse((await row(b.tenant, b.koi.id))?.hidden);

		// Deleting B's photo from A's portfolio leaves it.
		const deleted = await bulk(client, a.tenant, a.owner, {
			action: "delete",
			ids: [b.mandala.id],
			sizes: { [b.mandala.id]: 1 },
		});
		assert.equal(
			flashOf(deleted).error,
			"No photos were deleted. Not changed: 1 photo removed or changed meanwhile.",
		);
		assert.isNotNull(await row(b.tenant, b.mandala.id));
	});

	test("an artist changes only their own photos and can't move work", async ({
		client,
		assert,
	}) => {
		const s = await studio("pub-artist");
		const response = await bulk(client, s.tenant, s.member, {
			action: "unpublish",
			ids: [s.mandala.id, s.koi.id],
		});
		assert.equal(
			flashOf(response).error,
			"1 photo unpublished. Not changed: 1 photo removed or changed meanwhile.",
		);
		assert.isTrue((await row(s.tenant, s.mandala.id))?.hidden);
		assert.isFalse((await row(s.tenant, s.koi.id))?.hidden);

		const move = await bulk(client, s.tenant, s.member, {
			action: "reassign",
			ids: [s.mandala.id],
			artistId: s.sita.id,
		});
		move.assertStatus(302);
		assert.equal((await row(s.tenant, s.mandala.id))?.artistId, s.hari.id);
	});

	test("moving work: to another artist of the studio, never another studio's, never past 100", async ({
		client,
		assert,
	}) => {
		const s = await studio("pub-move");
		const other = await studio("pub-move-b");
		const moved = await bulk(client, s.tenant, s.owner, {
			action: "reassign",
			ids: [s.koi.id, s.rose.id],
			artistId: s.hari.id,
		});
		assert.equal(flashOf(moved).success, "2 photos moved to Hari Thapa.");
		const koi = await row(s.tenant, s.koi.id);
		assert.equal(koi?.artistId, s.hari.id);
		// Its date and its files stay.
		assert.equal(koi?.imageKey, s.koi.imageKey);
		assert.equal(koi?.createdAt.toMillis(), s.koi.createdAt.toMillis());

		const foreign = await bulk(client, s.tenant, s.owner, {
			action: "reassign",
			ids: [s.mandala.id],
			artistId: other.sita.id,
		});
		foreign.assertStatus(302);
		assert.deepInclude(
			foreign.flashMessage("inputErrorsBag") as Record<string, unknown>,
			{ artistId: ["Choose an artist of this studio."] },
		);
		assert.equal((await row(s.tenant, s.mandala.id))?.artistId, s.hari.id);

		// Sita at 100: moving one more to her is refused and named.
		await inTenant(s.tenant, async () => {
			for (let n = 0; n < 100; n += 1) await addWorkPhoto(s.tenant, s.sita);
		});
		const full = await bulk(client, s.tenant, s.owner, {
			action: "reassign",
			ids: [s.mandala.id],
			artistId: s.sita.id,
		});
		assert.equal(
			flashOf(full).error,
			"No photos were moved. Not changed: 1 photo over Sita Rai's limit of 100.",
		);
	});

	test("a bulk delete deletes the rows and their files, and says when files couldn't go", async ({
		client,
		assert,
	}) => {
		const s = await studio("pub-delete");
		const deleted = await bulk(client, s.tenant, s.owner, {
			action: "delete",
			ids: [s.koi.id, s.rose.id],
			sizes: { [s.koi.id]: 1, [s.rose.id]: 1 },
		});
		assert.equal(flashOf(deleted).success, "2 photos deleted.");
		assert.isNull(await row(s.tenant, s.koi.id));
		assert.isNull(await row(s.tenant, s.rose.id));

		const failing = failDeletes("public", () => true);
		try {
			const failed = await bulk(client, s.tenant, s.owner, {
				action: "delete",
				ids: [s.mandala.id],
				sizes: { [s.mandala.id]: 1 },
			});
			assert.equal(
				flashOf(failed).error,
				"No photos were deleted. Not changed: 1 photo whose files couldn't be removed (try again).",
			);
		} finally {
			failing.restore();
		}
		assert.isNotNull(await row(s.tenant, s.mandala.id));
	});

	test("the request is checked: an action, one to a page of photo ids, an artist to move to", async ({
		client,
		assert,
	}) => {
		const s = await studio("pub-valid");
		for (const body of [
			{ action: "archive", ids: [s.koi.id] },
			{ action: "publish", ids: [] },
			{ action: "publish", ids: ["not-a-uuid"] },
			{ action: "publish", ids: Array.from({ length: 41 }, () => s.koi.id) },
			{ action: "reassign", ids: [s.koi.id] },
		]) {
			const response = await bulk(client, s.tenant, s.owner, body);
			response.assertStatus(302);
			assert.exists(
				response.flashMessage("inputErrorsBag"),
				JSON.stringify(body),
			);
		}
	});

	test("an upload can start unpublished", async ({ client, assert }) => {
		const s = await studio("pub-upload");
		const { testImages } = await import("#tests/helpers/images");
		const response = await client
			.post(`/t/pub-upload/artists/${s.sita.id}/photos`)
			.file("photo", await testImages.jpeg(400, 500), { filename: "a.jpg" })
			.field("hidden", "1")
			.withCsrfToken()
			.loginAs(s.owner)
			.redirects(0);
		response.assertStatus(302);
		const newest = await inTenant(s.tenant, () =>
			ArtistWorkPhoto.query()
				.where("artist_id", s.sita.id)
				.orderBy("created_at", "desc")
				.firstOrFail(),
		);
		assert.isTrue(newest.hidden);
	});

	test("setHidden and reassign never reach another studio's photo", async ({
		assert,
	}) => {
		const a = await studio("pub-svc-a");
		const b = await studio("pub-svc-b");
		const photos = await app.container.make(WorkPhotoService);
		await inTenantAs(b.tenant, b.owner, async () => {
			await assert.rejects(() =>
				photos.findEditable(
					b.tenant,
					{ userId: b.owner.id, role: "owner" },
					a.koi.id,
				),
			);
		});
		await assert.rejects(() =>
			photos.setHidden(
				b.tenant,
				{ userId: b.owner.id, role: "owner" },
				a.koi,
				true,
			),
		);
		assert.isFalse((await row(a.tenant, a.koi.id))?.hidden);
	});
});

test.group("Portfolio review fixes (Studio OS)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a write on a photo moved to another artist meanwhile is a 404, not a change under the wrong lock", async ({
		assert,
	}) => {
		const s = await studio("pub-moved");
		const photos = await app.container.make(WorkPhotoService);
		const owner = { userId: s.owner.id, role: "owner" as const };
		await inTenantAs(s.tenant, s.owner, async () => {
			// Read before the move, as a page opened earlier would have it.
			const stale = await ArtistWorkPhoto.findOrFail(s.koi.id);
			await photos.reassign(s.tenant, owner, stale, s.hari.id);
			await assert.rejects(() =>
				photos.setHidden(s.tenant, owner, stale, true),
			);
			await assert.rejects(() => photos.remove(s.tenant, owner, stale));
			await assert.rejects(() =>
				photos.updateDetails(s.tenant, owner, stale, {
					alt: "x",
					styles: [],
					healed: false,
				}),
			);
		});
		const live = await row(s.tenant, s.koi.id);
		assert.equal(live?.artistId, s.hari.id);
		assert.isFalse(live?.hidden);
	});

	test("moving work to a deleted artist is refused, and to the artist it is with is said so", async ({
		client,
		assert,
	}) => {
		const s = await studio("pub-move-edge");
		await inTenant(s.tenant, async () => {
			await (await Artist.findOrFail(s.hari.id)).softDelete();
		});
		const deleted = await bulk(client, s.tenant, s.owner, {
			action: "reassign",
			ids: [s.koi.id],
			artistId: s.hari.id,
		});
		assert.deepInclude(
			deleted.flashMessage("inputErrorsBag") as Record<string, unknown>,
			{ artistId: ["Choose an artist of this studio."] },
		);
		const same = await bulk(client, s.tenant, s.owner, {
			action: "reassign",
			ids: [s.koi.id],
			artistId: s.sita.id,
		});
		assert.equal(
			flashOf(same).error,
			"No photos were moved. Not changed: 1 photo already with Sita Rai.",
		);
	});

	test("an upload from the portfolio sends no toast per photo; one from the profile still does", async ({
		client,
		assert,
	}) => {
		const s = await studio("pub-toast");
		const { testImages } = await import("#tests/helpers/images");
		const send = async (back?: string) => {
			const request = client
				.post(`/t/pub-toast/artists/${s.sita.id}/photos`)
				.file("photo", await testImages.jpeg(300, 300), { filename: "a.jpg" });
			if (back) request.field("back", back);
			return request.withCsrfToken().loginAs(s.owner).redirects(0);
		};
		assert.isUndefined(flashOf(await send("/t/pub-toast/portfolio")).success);
		assert.equal(flashOf(await send()).success, "Photo added.");
	});
});

test.group("Portfolio bulk summary (Studio OS)", () => {
	test("every failure is counted and named", ({ assert }) => {
		assert.deepEqual(bulkSummary("publish", 3, []), {
			ok: true,
			message: "3 photos published.",
		});
		assert.deepEqual(bulkSummary("reassign", 1, [], "Asha"), {
			ok: true,
			message: "1 photo moved to Asha.",
		});
		assert.deepEqual(bulkSummary("delete", 2, ["gone", "files", "files"]), {
			ok: false,
			message:
				"2 photos deleted. Not changed: 1 photo removed or changed meanwhile; 2 photos whose files couldn't be removed (try again).",
		});
		assert.equal(
			bulkSummary("reassign", 1, ["same"], "Asha").message,
			"1 photo moved to Asha. Not changed: 1 photo already with Asha.",
		);
		assert.equal(
			bulkSummary("unpublish", 0, ["gone"]).message,
			"No photos were unpublished. Not changed: 1 photo removed or changed meanwhile.",
		);
	});
});
