import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService, {
	type TenantProfile,
} from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
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
const tenancy = new TenancyService(undefined, images);
const artists = new ArtistService(images);

/** The documented fields (openapi.yaml, Studio). A new one needs the contract and a ruling first. */
const STUDIO_FIELDS = [
	"acceptingInquiries",
	"contact",
	"cover",
	"intro",
	"name",
	"slug",
	"socialLinks",
	"timezone",
	"type",
];
const CONTACT_FIELDS = ["address", "email", "phone"];
const LINK_FIELDS = ["platform", "url"];

const PROFILE: TenantProfile = {
	name: "Black Needle",
	timezone: "Asia/Kathmandu",
	intro: "Fine line and blackwork.\nWalk-ins on Saturdays.",
	contactPhone: "+9779812345678",
	contactEmail: "hello@black-needle.example",
	address: "Thamel Marg\nKathmandu",
	instagramUrl: "https://instagram.com/blackneedle",
	facebookUrl: null,
	tiktokUrl: "https://www.tiktok.com/@blackneedle",
	websiteUrl: "https://black-needle.example",
};

/** The public Studio of a studioWithOwner() studio: no profile filled in, no artists. */
const bareStudio = (slug: string, name: string) => ({
	slug,
	name,
	type: "studio",
	intro: null,
	timezone: "Asia/Kathmandu",
	contact: { phone: null, email: null, address: null },
	socialLinks: [],
	acceptingInquiries: true,
	cover: null,
});

function changeSlug(tenant: Tenant, slug: string) {
	return inTenant(tenant, () => tenancy.changeSlug(tenant, slug));
}

test.group("GET /api/v1/tenants/:tenant (getStudio)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("answers the studio's whole public profile", async ({ client }) => {
		const { owner, tenant } = await studioWithOwner(
			"api-needle-32",
			"Black Needle",
		);
		await inTenant(tenant, () => tenancy.updateProfile(tenant, PROFILE));
		await addArtist(tenant, owner, { acceptingInquiries: false });
		await addArtist(tenant, owner, { name: "Bina", slug: "bina" });

		const response = await client.get("/api/v1/tenants/api-needle-32");

		assertApiData(response, {
			slug: "api-needle-32",
			name: "Black Needle",
			type: "studio",
			intro: "Fine line and blackwork.\nWalk-ins on Saturdays.",
			timezone: "Asia/Kathmandu",
			contact: {
				phone: "+9779812345678",
				email: "hello@black-needle.example",
				address: "Thamel Marg\nKathmandu",
			},
			socialLinks: [
				{ platform: "instagram", url: "https://instagram.com/blackneedle" },
				{ platform: "tiktok", url: "https://www.tiktok.com/@blackneedle" },
				{ platform: "website", url: "https://black-needle.example" },
			],
			acceptingInquiries: true,
			cover: null,
		});
		assertApiHeaders(response);
	});

	test("has exactly the documented fields", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner("api-fields-44");
		await inTenant(tenant, () => tenancy.updateProfile(tenant, PROFILE));

		const { data } = (await client.get("/api/v1/tenants/api-fields-44")).body();

		assert.deepEqual(Object.keys(data).sort(), STUDIO_FIELDS);
		assert.deepEqual(Object.keys(data.contact).sort(), CONTACT_FIELDS);
		assert.isNotEmpty(data.socialLinks);
		for (const link of data.socialLinks) {
			assert.deepEqual(Object.keys(link).sort(), LINK_FIELDS);
		}
	});

	test("takes inquiries with no visible artist, not when every visible one is closed, again once one opens", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-open-44");
		const accepting = async () =>
			(await client.get("/api/v1/tenants/api-open-44")).body().data
				.acceptingInquiries;

		assert.isTrue(await accepting());
		await addArtist(tenant, owner, { acceptingInquiries: false });
		assert.isFalse(await accepting());
		await addArtist(tenant, owner, {
			name: "Hidden",
			slug: "hidden",
			visible: false,
		});
		assert.isFalse(await accepting());
		await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		assert.isTrue(await accepting());
	});

	test("closing the last open artist changes the answer and its ETag", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-etag-44");
		const bina = await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		const before =
			(await client.get("/api/v1/tenants/api-etag-44")).header("etag") ?? "";
		assert.isNotEmpty(before);

		await inTenant(tenant, () =>
			artists.update(
				tenant,
				bina,
				artistInput({ name: "Bina", slug: "bina", acceptingInquiries: false }),
				owner,
			),
		);
		const after = await client
			.get("/api/v1/tenants/api-etag-44")
			.header("if-none-match", before);

		after.assertStatus(200);
		assert.isFalse(after.body().data.acceptingInquiries);
		assert.notEqual(after.header("etag"), before);
	});

	test("a studio without a cover answers cover: null", async ({
		client,
		assert,
	}) => {
		await studioWithOwner("api-nocover-116");

		const { data } = (
			await client.get("/api/v1/tenants/api-nocover-116")
		).body();

		assert.isNull(data.cover);
	});

	test("a cover is its public URL, its size, alt null and its copies, in the studio's own folder", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-cover-116");
		const withCover = await inTenant(tenant, async () =>
			tenancy.setCover(
				tenant,
				await uploadOf(await testImages.jpeg(2048, 1536)),
			),
		);
		const url = await images.url(
			"studio_cover",
			withCover.coverImageKey ?? "",
			tenant,
		);

		const { data } = (await client.get("/api/v1/tenants/api-cover-116")).body();

		assert.deepEqual(Object.keys(data.cover).sort(), [
			"alt",
			"height",
			"url",
			"variants",
			"width",
		]);
		assert.equal(data.cover.url, url);
		assert.equal(data.cover.width, 2048);
		assert.equal(data.cover.height, 1536);
		assert.isNull(data.cover.alt);
		assert.deepEqual(
			data.cover.variants.map((variant: { width: number }) => variant.width),
			[640, 960, 1280, 1600],
		);
		for (const variant of data.cover.variants) {
			assert.deepEqual(Object.keys(variant).sort(), ["url", "width"]);
			assert.equal(new URL(variant.url).origin, new URL(url).origin);
			assert.match(
				new URL(variant.url).pathname,
				new RegExp(`^/uploads/tenants/${tenant.id}/studio_cover/`),
			);
			(await client.get(new URL(variant.url).pathname)).assertStatus(200);
		}
		// The stored key and the tenant row's columns never show.
		const text = JSON.stringify(data);
		assert.notInclude(text, "cover_image");
		assert.notInclude(text, "coverImage");
	});

	test("setting or removing the cover changes the ETag; the cache headers stay", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-coveretag-116");
		const url = "/api/v1/tenants/api-coveretag-116";
		const bare = await client.get(url);
		bare.assertHeader("cache-control", CACHED);
		const bareTag = bare.header("etag") ?? "";

		await inTenant(tenant, async () =>
			tenancy.setCover(
				tenant,
				await uploadOf(await testImages.jpeg(2048, 1536)),
			),
		);
		const set = await client.get(url).header("if-none-match", bareTag);
		set.assertStatus(200);
		set.assertHeader("cache-control", CACHED);
		assert.notEqual(set.header("etag"), bareTag);

		await inTenant(tenant, () => tenancy.removeCover(tenant));
		const removed = await client.get(url);
		assert.equal(removed.header("etag"), bareTag);
	});

	test("an independent artist's studio says so", async ({ client }) => {
		const owner = await User.create({
			email: "owner@api-solo-44.example",
			password: "secret-password",
		});
		await tenancy.createTenant(owner, {
			type: "independent",
			name: "Solo Ink",
			slug: "api-solo-44",
			timezone: "Asia/Kathmandu",
		});

		assertApiData(await client.get("/api/v1/tenants/api-solo-44"), {
			...bareStudio("api-solo-44", "Solo Ink"),
			type: "independent",
		});
	});

	test("a link that isn't https is left out", async ({ client }) => {
		const { tenant } = await studioWithOwner("api-links-44");
		await inTenant(tenant, () =>
			dbClient().rawQuery(
				"update tenants set instagram_url = ?, facebook_url = ?, tiktok_url = ?, website_url = ? where id = ?",
				[
					"javascript:alert(1)",
					"http://facebook.com/needle",
					"not a link",
					"https://needle.example",
					tenant.id,
				],
			),
		);

		assertApiData(await client.get("/api/v1/tenants/api-links-44"), {
			...bareStudio("api-links-44", "Black Needle"),
			socialLinks: [{ platform: "website", url: "https://needle.example" }],
		});
	});

	test("under an old slug, answers with the current slug", async ({
		client,
	}) => {
		const { tenant } = await studioWithOwner("api-needle-32", "Black Needle");
		await changeSlug(tenant, "api-red-32");

		assertApiData(
			await client.get("/api/v1/tenants/api-needle-32"),
			bareStudio("api-red-32", "Black Needle"),
		);
	});

	test("is cacheable: public, stale-while-revalidate, an ETag, and a 304 for a matching If-None-Match", async ({
		client,
		assert,
	}) => {
		await studioWithOwner("api-needle-32");

		const first = await client.get("/api/v1/tenants/api-needle-32");
		first.assertHeader("cache-control", CACHED);
		const etag = first.header("etag") ?? "";
		assert.isNotEmpty(etag);

		const again = await client
			.get("/api/v1/tenants/api-needle-32")
			.header("if-none-match", etag);
		again.assertStatus(304);
		again.assertHeader("cache-control", CACHED);
		again.assertHeader("etag", etag);
		assertNoCookies(again);
	});

	test("a changed studio gets a new ETag, and the old tag a full answer", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-needle-32", "Black Needle");
		const before =
			(await client.get("/api/v1/tenants/api-needle-32")).header("etag") ?? "";
		assert.isNotEmpty(before);

		await inTenant(tenant, () =>
			dbClient().rawQuery(
				"update tenants set name = 'Red Needle' where id = ?",
				[tenant.id],
			),
		);
		const after = await client
			.get("/api/v1/tenants/api-needle-32")
			.header("if-none-match", before);

		assertApiData(after, bareStudio("api-needle-32", "Red Needle"));
		assert.notEqual(after.header("etag"), before);
	});

	test("HEAD has the same cache headers and no body", async ({ client }) => {
		await studioWithOwner("api-needle-32");
		const etag = (await client.get("/api/v1/tenants/api-needle-32")).header(
			"etag",
		);

		const head = await client.head("/api/v1/tenants/api-needle-32");

		head.assertStatus(200);
		head.assertHeader("cache-control", CACHED);
		head.assertHeader("etag", etag);
		assertNoCookies(head);
	});

	test("an unknown tenant is a 404 and a POST a 405, both no-store", async ({
		client,
	}) => {
		await studioWithOwner("api-needle-32");

		assertApiError(
			await client.get("/api/v1/tenants/no-such-studio-td32"),
			404,
			"not_found",
		);
		const post = await client.post("/api/v1/tenants/api-needle-32").json({});
		assertApiError(post, 405, "method_not_allowed");
		post.assertHeader("allow", "GET, HEAD");
	});
});
