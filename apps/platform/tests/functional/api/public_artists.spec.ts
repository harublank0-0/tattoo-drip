import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import type Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import {
	assertApiData,
	assertApiError,
	assertApiHeaders,
	assertNoCookies,
} from "#tests/helpers/api";
import { addArtist, artistInput } from "#tests/helpers/artists";
import { testImages, uploadOf } from "#tests/helpers/images";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const CACHED = "public, max-age=60, stale-while-revalidate=600";
const images = new ImageService();
const artists = new ArtistService(images);
const tenancy = new TenancyService();

/** The documented fields (openapi.yaml, Artist and Image). A new one needs the contract and a ruling first. */
const ARTIST_FIELDS = [
	"acceptingInquiries",
	"bio",
	"closedMessage",
	"id",
	"name",
	"photo",
	"slug",
];
const PHOTO_FIELDS = ["height", "url", "width"];

/** The public Artist of a profile without a photo. */
const shown = (artist: Artist) => ({
	id: artist.id,
	slug: artist.slug,
	name: artist.name,
	bio: artist.bio,
	photo: null,
	acceptingInquiries: artist.acceptingInquiries,
	closedMessage: artist.acceptingInquiries ? null : artist.closedMessage,
});

function changeSlug(tenant: Tenant, slug: string) {
	return inTenant(tenant, () => tenancy.changeSlug(tenant, slug));
}

function remove(tenant: Tenant, artist: Artist) {
	return inTenant(tenant, () => artists.delete(tenant, artist));
}

test.group("GET /api/v1/tenants/:tenant/artists (listArtists)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists the visible artists by name, a closed one with its message", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-artists-44");
		const zara = await addArtist(tenant, owner, {
			name: "zara",
			slug: "zara",
			bio: "Blackwork and dotwork.",
			acceptingInquiries: false,
			closedMessage: "Books open in March.",
		});
		// Open, linked to the owner, holding a message from an earlier closing.
		const bina = await addArtist(tenant, owner, {
			name: "Bina",
			slug: "bina",
			closedMessage: "Back next week.",
			linkToMe: true,
		});
		await addArtist(tenant, owner, {
			name: "Hidden",
			slug: "hidden",
			visible: false,
		});
		await remove(
			tenant,
			await addArtist(tenant, owner, { name: "Gone", slug: "gone" }),
		);

		const response = await client.get("/api/v1/tenants/api-artists-44/artists");

		assertApiData(response, [shown(bina), shown(zara)]);
		assertApiHeaders(response);
	});

	test("each artist has exactly the documented fields, and a photo its public URL and size", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-photo-44");
		const sita = await addArtist(tenant, owner, {
			photo: await uploadOf(await testImages.png(300, 200)),
		});
		const url = await images.url("artist_photo", sita.photoKey ?? "", tenant);

		const { data } = (
			await client.get("/api/v1/tenants/api-photo-44/artists")
		).body();

		assert.lengthOf(data, 1);
		assert.deepEqual(Object.keys(data[0]).sort(), ARTIST_FIELDS);
		assert.deepEqual(Object.keys(data[0].photo).sort(), PHOTO_FIELDS);
		assert.deepEqual(data[0].photo, { url, width: 300, height: 200 });
		// The studio's own public folder, nothing else.
		assert.match(
			new URL(url).pathname,
			new RegExp(`^/uploads/tenants/${tenant.id}/artist_photo/`),
		);
	});

	test("a studio with no visible artist answers an empty list", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-empty-44");
		await addArtist(tenant, owner, { visible: false });

		assertApiData(await client.get("/api/v1/tenants/api-empty-44/artists"), []);
	});

	test("an independent artist's studio lists their own profile, at the studio's slug", async ({
		client,
		assert,
	}) => {
		const owner = await User.create({
			email: "owner@api-solo-artists-44.example",
			password: "secret-password",
		});
		await tenancy.createTenant(owner, {
			type: "independent",
			name: "Solo Ink",
			slug: "api-solo-artists-44",
			timezone: "Asia/Kathmandu",
		});

		const list = await client.get(
			"/api/v1/tenants/api-solo-artists-44/artists",
		);
		const one = await client.get(
			"/api/v1/tenants/api-solo-artists-44/artists/api-solo-artists-44",
		);

		list.assertStatus(200);
		assert.lengthOf(list.body().data, 1);
		assert.equal(list.body().data[0].name, "Solo Ink");
		assertApiData(one, list.body().data[0]);
	});

	test("is cacheable: public, an ETag and a 304; HEAD the same", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-cache-44");
		await addArtist(tenant, owner);
		const url = "/api/v1/tenants/api-cache-44/artists";

		const first = await client.get(url);
		first.assertHeader("cache-control", CACHED);
		const etag = first.header("etag") ?? "";
		assert.isNotEmpty(etag);

		const again = await client.get(url).header("if-none-match", etag);
		again.assertStatus(304);
		assertNoCookies(again);
		const head = await client.head(url);
		head.assertStatus(200);
		head.assertHeader("cache-control", CACHED);
		head.assertHeader("etag", etag);
	});

	test("under an old studio slug, answers like under the current one", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-old-44");
		const sita = await addArtist(tenant, owner);
		await changeSlug(tenant, "api-new-44");

		assertApiData(await client.get("/api/v1/tenants/api-old-44/artists"), [
			shown(sita),
		]);
		assertApiData(await client.get("/api/v1/tenants/api-new-44/artists"), [
			shown(sita),
		]);
	});

	test("an unknown studio is a 404 and a POST a 405, both no-store", async ({
		client,
	}) => {
		await studioWithOwner("api-405-44");

		assertApiError(
			await client.get("/api/v1/tenants/no-such-studio-td44/artists"),
			404,
			"not_found",
		);
		const post = await client
			.post("/api/v1/tenants/api-405-44/artists")
			.json({});
		assertApiError(post, 405, "method_not_allowed");
		post.assertHeader("allow", "GET, HEAD");
	});
});

test.group(
	"GET /api/v1/tenants/:tenant/artists/:artist (getArtist)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("answers one visible artist by slug, a closed one with its message", async ({
			client,
		}) => {
			const { owner, tenant } = await studioWithOwner("api-one-44");
			const zara = await addArtist(tenant, owner, {
				name: "Zara",
				slug: "zara",
				acceptingInquiries: false,
				closedMessage: "Books open in March.",
			});

			const response = await client.get(
				"/api/v1/tenants/api-one-44/artists/zara",
			);

			assertApiData(response, shown(zara));
			assertApiHeaders(response);
			response.assertHeader("cache-control", CACHED);
		});

		test("a hidden, deleted, unknown, malformed or differently cased slug is the same 404", async ({
			client,
		}) => {
			const { owner, tenant } = await studioWithOwner("api-missing-44");
			await addArtist(tenant, owner, { name: "Zara", slug: "zara" });
			await addArtist(tenant, owner, {
				name: "Hidden",
				slug: "hidden",
				visible: false,
			});
			await remove(
				tenant,
				await addArtist(tenant, owner, { name: "Gone", slug: "gone" }),
			);

			for (const slug of [
				"hidden",
				"gone",
				"nobody",
				"Zara",
				"ZARA",
				"-zara",
				"zara-",
				"z",
				"x".repeat(64),
				"zara%20",
				"zara.json",
			]) {
				assertApiError(
					await client.get(`/api/v1/tenants/api-missing-44/artists/${slug}`),
					404,
					"not_found",
				);
			}
		});

		test("another studio's artist is a 404 under this studio's slug", async ({
			client,
		}) => {
			await studioWithOwner("api-mine-44");
			const theirs = await studioWithOwner("api-theirs-44");
			await addArtist(theirs.tenant, theirs.owner, {
				name: "Only B",
				slug: "only-b",
			});

			assertApiError(
				await client.get("/api/v1/tenants/api-mine-44/artists/only-b"),
				404,
				"not_found",
			);
			(
				await client.get("/api/v1/tenants/api-theirs-44/artists/only-b")
			).assertStatus(200);
		});

		test("a renamed artist's old slug is a 404, and a deleted artist's slug shows whoever takes it next", async ({
			client,
		}) => {
			const { owner, tenant } = await studioWithOwner("api-renamed-44");
			const sita = await addArtist(tenant, owner, {
				name: "Sita",
				slug: "sita",
			});
			const renamed = await inTenant(tenant, () =>
				artists.update(
					tenant,
					sita,
					artistInput({ name: "Sita", slug: "sita-rai" }),
					owner,
				),
			);

			assertApiError(
				await client.get("/api/v1/tenants/api-renamed-44/artists/sita"),
				404,
				"not_found",
			);
			assertApiData(
				await client.get("/api/v1/tenants/api-renamed-44/artists/sita-rai"),
				shown(renamed),
			);

			await remove(tenant, renamed);
			const next = await addArtist(tenant, owner, {
				name: "Sita Gurung",
				slug: "sita-rai",
			});

			assertApiData(
				await client.get("/api/v1/tenants/api-renamed-44/artists/sita-rai"),
				shown(next),
			);
		});

		test("under an old studio slug, answers like under the current one, with the same ETag; HEAD works", async ({
			client,
			assert,
		}) => {
			const { owner, tenant } = await studioWithOwner("api-alias-44");
			const sita = await addArtist(tenant, owner);
			await changeSlug(tenant, "api-alias-new-44");

			const old = await client.get("/api/v1/tenants/api-alias-44/artists/sita");
			assertApiData(old, shown(sita));
			const etag = old.header("etag") ?? "";
			assert.isNotEmpty(etag);
			(
				await client
					.get("/api/v1/tenants/api-alias-new-44/artists/sita")
					.header("if-none-match", etag)
			).assertStatus(304);
			const head = await client.head(
				"/api/v1/tenants/api-alias-44/artists/sita",
			);
			head.assertStatus(200);
			head.assertHeader("etag", etag);
		});

		test("a POST is a 405 with Allow: GET, HEAD", async ({ client }) => {
			const { owner, tenant } = await studioWithOwner("api-post-44");
			await addArtist(tenant, owner);

			const post = await client
				.post("/api/v1/tenants/api-post-44/artists/sita")
				.json({});

			assertApiError(post, 405, "method_not_allowed");
			post.assertHeader("allow", "GET, HEAD");
		});
	},
);
