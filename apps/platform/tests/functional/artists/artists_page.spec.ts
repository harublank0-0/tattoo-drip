import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import ArtistService, {
	type ArtistInput,
} from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import { testImages, uploadOf } from "#tests/helpers/images";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const artists = new ArtistService(new ImageService());
const base = "/t/black-needle/artists";

const input = (over: Partial<ArtistInput> = {}): ArtistInput => ({
	name: "Sita Rai",
	slug: "sita",
	bio: null,
	visible: true,
	acceptingInquiries: true,
	closedMessage: null,
	linkToMe: false,
	styles: [],
	instagramUrl: null,
	facebookUrl: null,
	tiktokUrl: null,
	...over,
});

test.group("Artists page", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sees the artists by name, with photo URLs, and which one is theirs", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, async () => {
			await artists.create(
				tenant,
				input({
					name: "bea",
					slug: "bea",
					photo: await uploadOf(await testImages.png()),
				}),
				owner,
			);
			await artists.create(
				tenant,
				input({ name: "Ada", slug: "ada", linkToMe: true, visible: false }),
				owner,
			);
		});

		const response = await client.get(base).withInertia().loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("artists/index");
		const list = response.inertiaProps.artists;
		assert.deepEqual(
			list.map(({ name }: { name: string }) => name),
			["Ada", "bea"],
		);
		assert.isFalse(list[0].visible);
		assert.isTrue(list[0].isMine);
		assert.isNull(list[0].photoUrl);
		assert.isFalse(list[1].isMine);
		assert.match(new URL(list[1].photoUrl).pathname, /^\/uploads\/tenants\//);
		// The page gets what it shows, not the row.
		assert.notProperty(list[0], "tenantId");
		assert.notProperty(list[0], "userId");
		// Only the edit form uses these (TAT-84).
		assert.notProperty(list[0], "slug");
		assert.notProperty(list[0], "bio");
		assert.notProperty(list[0], "closedMessage");
	});

	test("the list shows the photo's 320 px copy, not the full image", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, async () =>
			artists.create(
				tenant,
				input({ photo: await uploadOf(await testImages.jpeg(1000, 800)) }),
				owner,
			),
		);

		const [artist] = (await client.get(base).withInertia().loginAs(owner))
			.inertiaProps.artists;

		assert.match(
			new URL(artist.photoUrl).pathname,
			/^\/uploads\/tenants\/[^/]+\/artist_photo\/[^/]+\.320w\.jpg$/,
		);
	});

	test("an owner deletes an artist", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await inTenant(tenant, () =>
			artists.create(tenant, input(), owner),
		);

		const response = await client
			.delete(`${base}/${artist.id}`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", base);
		response.assertFlashMessage("success", '"Sita Rai" deleted.');
		await inTenant(tenant, async () => {
			assert.isEmpty(await artists.list(tenant));
			const deleted = await Artist.withTrashed()
				.where("id", artist.id)
				.firstOrFail();
			assert.isNotNull(deleted.deletedAt);
		});
	});
});

test.group("Artists page access", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an artist-role member gets 404 on every artists route", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const member = await artistIn(tenant);
		const artist = await inTenant(tenant, () =>
			artists.create(tenant, input(), owner),
		);

		for (const request of [
			client.get(base),
			client.get(`${base}/new`),
			client.post(base).fields({ name: "Sneaky", slug: "sneaky" }),
			client.get(`${base}/${artist.id}/edit`),
			client
				.put(`${base}/${artist.id}`)
				.fields({ name: "Sneaky", slug: "sita" }),
			client.delete(`${base}/${artist.id}`),
		]) {
			const response = await request.withCsrfToken().loginAs(member);
			response.assertStatus(404);
		}
		const live = await inTenant(tenant, () => artists.list(tenant));
		assert.deepEqual(
			live.map(({ name }) => name),
			["Sita Rai"],
		);
	});

	test("another tenant's owner gets 404 on an artist, which stays as it was", async ({
		client,
		assert,
	}) => {
		const { owner: blackNeedleOwner, tenant: blackNeedle } =
			await studioWithOwner("black-needle");
		const { owner: redInkOwner } = await studioWithOwner("red-ink", "Red Ink");
		const artist = await inTenant(blackNeedle, () =>
			artists.create(blackNeedle, input(), blackNeedleOwner),
		);

		for (const request of [
			client.get(`/t/red-ink/artists/${artist.id}/edit`),
			client
				.put(`/t/red-ink/artists/${artist.id}`)
				.fields({ name: "Mine", slug: "mine" }),
			// An invalid body is still a 404, not a validation redirect: the
			// artist is loaded before the body is validated.
			client
				.put(`/t/red-ink/artists/${artist.id}`)
				.fields({ name: "", slug: "-" }),
			client.delete(`/t/red-ink/artists/${artist.id}`),
		]) {
			const response = await request.withCsrfToken().loginAs(redInkOwner);
			response.assertStatus(404);
		}
		const saved = await inTenant(blackNeedle, () =>
			Artist.findOrFail(artist.id),
		);
		assert.equal(saved.name, "Sita Rai");
		assert.isNull(saved.deletedAt);
	});

	test("a deleted artist gets 404 on edit, update and delete", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await inTenant(tenant, () =>
			artists.create(tenant, input(), owner),
		);
		await inTenant(tenant, () => artists.delete(tenant, artist));

		for (const request of [
			client.get(`${base}/${artist.id}/edit`),
			client.put(`${base}/${artist.id}`).fields({ name: "Back", slug: "back" }),
			client.put(`${base}/${artist.id}`).fields({ name: "", slug: "-" }),
			client.delete(`${base}/${artist.id}`),
		]) {
			const response = await request.withCsrfToken().loginAs(owner);
			response.assertStatus(404);
		}
	});

	test("an id that isn't a UUID gets 404, not a server error", async ({
		client,
	}) => {
		const { owner } = await studioWithOwner();

		for (const request of [
			client.get(`${base}/not-a-uuid/edit`),
			client
				.put(`${base}/not-a-uuid`)
				.fields({ name: "Sneaky", slug: "sneaky" }),
			client.delete(`${base}/not-a-uuid`),
		]) {
			const response = await request.withCsrfToken().loginAs(owner);
			response.assertStatus(404);
		}
	});
});
