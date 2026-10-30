import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import WorkPhotoService from "#modules/artists/services/work_photo_service";
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import {
	assertApiData,
	assertApiError,
	assertApiHeaders,
	assertNoCookies,
} from "#tests/helpers/api";
import { addArtist, addWorkPhoto, artistInput } from "#tests/helpers/artists";
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
	"socialLinks",
	"styles",
	"workPhotos",
];
const WORK_PHOTO_FIELDS = ["alt", "height", "url", "variants", "width"];
const PHOTO_FIELDS = ["height", "url", "variants", "width"];

/** The public Artist of a profile without a photo, styles or links. */
const shown = (artist: Artist) => ({
	id: artist.id,
	slug: artist.slug,
	name: artist.name,
	bio: artist.bio,
	photo: null,
	acceptingInquiries: artist.acceptingInquiries,
	closedMessage: artist.acceptingInquiries ? null : artist.closedMessage,
	workPhotos: [],
	styles: [],
	socialLinks: [],
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
		assert.deepEqual(data[0].photo, {
			url,
			width: 300,
			height: 200,
			variants: [],
		});
		// The studio's own public folder, nothing else.
		assert.match(
			new URL(url).pathname,
			new RegExp(`^/uploads/tenants/${tenant.id}/artist_photo/`),
		);
	});

	test("a wide photo has its smaller copies, narrowest first, on the photo's origin and in the studio's own folder", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-copies-112");
		await addArtist(tenant, owner, {
			photo: await uploadOf(await testImages.jpeg(2000, 1500)),
		});

		const { data } = (
			await client.get("/api/v1/tenants/api-copies-112/artists")
		).body();

		const photo = data[0].photo;
		assert.deepEqual(
			photo.variants.map((variant: { width: number }) => variant.width),
			[320, 640, 1280],
		);
		for (const variant of photo.variants) {
			assert.deepEqual(Object.keys(variant).sort(), ["url", "width"]);
			assert.equal(new URL(variant.url).origin, new URL(photo.url).origin);
			assert.match(
				new URL(variant.url).pathname,
				new RegExp(`^/uploads/tenants/${tenant.id}/artist_photo/`),
			);
			(await client.get(new URL(variant.url).pathname)).assertStatus(200);
		}
	});

	test("work photos are the six newest, newest first, with exactly url, width, height, alt and variants", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-work-116");
		const sita = await addArtist(tenant, owner);
		const photos = new WorkPhotoService(images, artists);
		const editor = { userId: owner.id, role: "owner" } as const;
		const added = await inTenant(tenant, async () => {
			const rows = [];
			for (let n = 0; n < 8; n++) {
				// One narrow photo (no smaller copies); the rest are wide.
				const bytes =
					n === 6
						? await testImages.jpeg(300, 400)
						: await testImages.jpeg(1600, 1200);
				rows.push(
					await photos.add(tenant, editor, sita, await uploadOf(bytes)),
				);
			}
			return rows;
		});
		await inTenant(tenant, () =>
			photos.updateDetails(tenant, editor, added[7], {
				alt: "Koi on the forearm",
				styles: ["realism"],
				healed: true,
			}),
		);

		const { data } = (
			await client.get("/api/v1/tenants/api-work-116/artists")
		).body();
		const one = (
			await client.get("/api/v1/tenants/api-work-116/artists/sita")
		).body().data;

		const work = data[0].workPhotos;
		assert.lengthOf(work, 6);
		assert.deepEqual(one.workPhotos, work);
		// The six newest (added 7 down to 2), newest first: the URLs hold the keys.
		assert.deepEqual(
			work.map((photo: { url: string }) => new URL(photo.url).pathname),
			added
				.slice(2)
				.reverse()
				.map((row) => `/uploads/${row.imageKey}`),
		);
		for (const photo of work) {
			assert.deepEqual(Object.keys(photo).sort(), WORK_PHOTO_FIELDS);
			assert.match(
				new URL(photo.url).pathname,
				new RegExp(`^/uploads/tenants/${tenant.id}/artist_work_photo/`),
			);
			(await client.get(new URL(photo.url).pathname)).assertStatus(200);
		}
		assert.equal(work[0].alt, "Koi on the forearm");
		assert.deepEqual(
			work[0].variants.map((variant: { width: number }) => variant.width),
			[320, 640, 1280],
		);
		assert.equal(work[1].width, 300);
		assert.isNull(work[1].alt);
		assert.deepEqual(work[1].variants, []);
		// Never the row: no id, key, position, styles, healed, artist id or timestamp.
		const text = JSON.stringify(work);
		for (const word of [
			"position",
			"styles",
			"healed",
			"artist_id",
			"artistId",
			"created",
			"imageKey",
			"realism",
		]) {
			assert.notInclude(text, word);
		}
		for (const row of added) assert.notInclude(text, row.id);
	});

	test("styles come in the list's order as slug and name, an unknown one dropped", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-styles-site1");
		const sita = await addArtist(tenant, owner);
		// A slug that has since left the list, written past the validator.
		await inTenant(tenant, () =>
			Artist.query()
				.where("id", sita.id)
				.update({ styles: ["realism", "retired-style", "blackwork"] }),
		);

		const list = (
			await client.get("/api/v1/tenants/api-styles-site1/artists")
		).body().data;
		const one = (
			await client.get("/api/v1/tenants/api-styles-site1/artists/sita")
		).body().data;

		const expected = [
			{ slug: "blackwork", name: "Blackwork" },
			{ slug: "realism", name: "Realism" },
		];
		assert.deepEqual(list[0].styles, expected);
		assert.deepEqual(one.styles, expected);
		for (const style of list[0].styles) {
			assert.deepEqual(Object.keys(style).sort(), ["name", "slug"]);
		}
	});

	test("social links are the set https ones, in order", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-links-site1");
		const sita = await addArtist(tenant, owner, {
			tiktokUrl: "https://www.tiktok.com/@sita",
			instagramUrl: "https://instagram.com/sita",
		});
		// A plain-http link, written past the validator: never sent.
		await inTenant(tenant, () =>
			Artist.query()
				.where("id", sita.id)
				.update({ facebookUrl: "http://facebook.com/sita" }),
		);

		const list = (
			await client.get("/api/v1/tenants/api-links-site1/artists")
		).body().data;
		const one = (
			await client.get("/api/v1/tenants/api-links-site1/artists/sita")
		).body().data;

		const expected = [
			{ platform: "instagram", url: "https://instagram.com/sita" },
			{ platform: "tiktok", url: "https://www.tiktok.com/@sita" },
		];
		assert.deepEqual(list[0].socialLinks, expected);
		assert.deepEqual(one.socialLinks, expected);
		for (const link of list[0].socialLinks) {
			assert.deepEqual(Object.keys(link).sort(), ["platform", "url"]);
		}
	});

	test("an artist with no styles or links has empty lists", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-bare-site1");
		await addArtist(tenant, owner);

		const { data } = (
			await client.get("/api/v1/tenants/api-bare-site1/artists")
		).body();

		assert.deepEqual(data[0].styles, []);
		assert.deepEqual(data[0].socialLinks, []);
	});

	test("a closed artist shows their work, and the list is the one-artist answer", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-workclosed-116");
		const closed = await addArtist(tenant, owner, {
			acceptingInquiries: false,
			closedMessage: "Books open in March.",
		});
		await inTenant(tenant, () =>
			addWorkPhoto(tenant, closed, { alt: "Still shown" }),
		);

		const list = (
			await client.get("/api/v1/tenants/api-workclosed-116/artists")
		).body().data;

		assert.isFalse(list[0].acceptingInquiries);
		assert.equal(list[0].closedMessage, "Books open in March.");
		assert.deepEqual(
			list[0].workPhotos.map((photo: { alt: string }) => photo.alt),
			["Still shown"],
		);
	});

	test("adding a photo or saving its details changes the list's ETag", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-worketag-116");
		const sita = await addArtist(tenant, owner);
		const editor = { userId: owner.id, role: "owner" } as const;
		const photos = new WorkPhotoService(images, artists);
		const url = "/api/v1/tenants/api-worketag-116/artists";
		const etags = [(await client.get(url)).header("etag")];

		const first = await inTenant(tenant, async () =>
			photos.add(
				tenant,
				editor,
				sita,
				await uploadOf(await testImages.jpeg(1600, 1200)),
			),
		);
		etags.push((await client.get(url)).header("etag"));
		const second = await inTenant(tenant, async () =>
			photos.add(
				tenant,
				editor,
				sita,
				await uploadOf(await testImages.jpeg(1600, 1200)),
			),
		);
		etags.push((await client.get(url)).header("etag"));
		await inTenant(tenant, () =>
			photos.updateDetails(tenant, editor, second, {
				alt: "Koi",
				styles: [],
				healed: false,
			}),
		);
		etags.push((await client.get(url)).header("etag"));
		await inTenant(tenant, () => photos.remove(tenant, editor, first));
		etags.push((await client.get(url)).header("etag"));

		assert.lengthOf(
			new Set(etags),
			etags.length,
			"every change shows in the ETag",
		);
		const same = await client
			.get(url)
			.header("if-none-match", etags.at(-1) ?? "");
		same.assertStatus(304);
	});

	test("a studio with no visible artist answers an empty list", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-empty-44");
		await addArtist(tenant, owner, { visible: false });

		assertApiData(await client.get("/api/v1/tenants/api-empty-44/artists"), []);
	});

	test("an independent artist's studio lists their own profile, at the slug the studio had when it was created; a rename does not move it", async ({
		client,
		assert,
	}) => {
		const owner = await User.create({
			email: "owner@api-solo-artists-44.example",
			password: "secret-password",
		});
		const tenant = await tenancy.createTenant(owner, {
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

		// The profile copied the studio's slug once. After a rename the studio
		// has a new slug but the profile keeps its own, and nothing aliases it.
		await changeSlug(tenant, "api-solo-renamed-44");

		const renamedList = await client.get(
			"/api/v1/tenants/api-solo-renamed-44/artists",
		);
		assertApiData(renamedList, list.body().data);
		assertApiData(
			await client.get(
				"/api/v1/tenants/api-solo-renamed-44/artists/api-solo-artists-44",
			),
			list.body().data[0],
		);
		assertApiError(
			await client.get(
				"/api/v1/tenants/api-solo-renamed-44/artists/api-solo-renamed-44",
			),
			404,
			"not_found",
		);
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

		const unknown = await client.get(
			"/api/v1/tenants/no-such-studio-td44/artists",
		);
		assertApiError(unknown, 404, "not_found");
		unknown.assertHeader("cache-control", "no-store");
		const post = await client
			.post("/api/v1/tenants/api-405-44/artists")
			.json({});
		assertApiError(post, 405, "method_not_allowed");
		post.assertHeader("allow", "GET, HEAD");
		post.assertHeader("cache-control", "no-store");
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

		test("a hidden, deleted, unknown, malformed or differently cased slug is the same 404: same body, same headers", async ({
			client,
			assert,
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

			// "hidden" reaches the handler (its 404 is ApiException.notFound());
			// "ZARA" never leaves the router's matcher. Each answer must be the
			// handler's, byte for byte: body and headers, not only status and code.
			const missing = async (slug: string) =>
				client.get(`/api/v1/tenants/api-missing-44/artists/${slug}`);
			const handlerLevel = await missing("hidden");
			assertApiError(handlerLevel, 404, "not_found");
			handlerLevel.assertHeader("cache-control", "no-store");
			const bodyOf404 = handlerLevel.body();
			const headersOf404 = (response: Awaited<ReturnType<typeof missing>>) => ({
				"cache-control": response.header("cache-control"),
				"content-type": response.header("content-type"),
				"x-content-type-options": response.header("x-content-type-options"),
				"access-control-allow-origin": response.header(
					"access-control-allow-origin",
				),
				etag: response.header("etag"),
			});

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
				const response = await missing(slug);
				assertApiError(response, 404, "not_found");
				assert.deepEqual(response.body(), bodyOf404, `${slug}: the body`);
				assert.deepEqual(
					headersOf404(response),
					headersOf404(handlerLevel),
					`${slug}: the headers`,
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
			post.assertHeader("cache-control", "no-store");
		});
	},
);
