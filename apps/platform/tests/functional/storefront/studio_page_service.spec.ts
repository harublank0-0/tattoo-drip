import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import ArtistService from "#modules/artists/services/artist_service";
import WorkPhotoService from "#modules/artists/services/work_photo_service";
import ImageService from "#modules/media/services/image_service";
import StudioPageService from "#modules/storefront/services/studio_page_service";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService, {
	type TenantProfile,
} from "#modules/tenancy/services/tenancy_service";
import { addArtist, addWorkPhoto } from "#tests/helpers/artists";
import { testImages, uploadOf } from "#tests/helpers/images";
import { recordQueries } from "#tests/helpers/query_count";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Counts the artist reads, so a test sees one query per call: `reads` for
 * listVisible (the studio and the list), `slugReads` for findVisibleBySlug
 * (one artist).
 */
class CountingArtists extends ArtistService {
	reads = 0;
	slugReads = 0;

	override async listVisible(
		...args: Parameters<ArtistService["listVisible"]>
	) {
		this.reads++;
		return super.listVisible(...args);
	}

	override async findVisibleBySlug(
		...args: Parameters<ArtistService["findVisibleBySlug"]>
	) {
		this.slugReads++;
		return super.findVisibleBySlug(...args);
	}
}

const images = new ImageService();
const pagesWith = (artists: ArtistService = new ArtistService(images)) =>
	new StudioPageService(artists, images, new WorkPhotoService(images, artists));

/** The look of a studio that set nothing (TAT-56). */
const DEFAULT_LOOK = {
	theme: "stencil-and-ink",
	accent: null,
	accentDark: null,
	font: "eczar",
	sections: ["artists", "inquiry"],
};

const PROFILE: TenantProfile = {
	name: "Page Needle",
	timezone: "Asia/Kathmandu",
	intro: "Fine line and blackwork.",
	contactPhone: "+9779812345678",
	contactEmail: "hello@page-needle.example",
	address: "Thamel Marg\nKathmandu",
	instagramUrl: "https://instagram.com/pageneedle",
	facebookUrl: null,
	tiktokUrl: null,
	websiteUrl: "https://page-needle.example",
};

test.group("StudioPageService.studio", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("gives the public profile, the current slug and the type", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("page-needle-44");
		await inTenant(tenant, () =>
			new TenancyService().updateProfile(tenant, PROFILE),
		);

		const page = await inTenant(tenant, () => pagesWith().studio(tenant));

		assert.deepEqual(page, {
			profile: { ...PROFILE, slug: "page-needle-44", type: "studio" },
			acceptingInquiries: true,
			cover: null,
			storefront: { look: DEFAULT_LOOK, logo: null },
		});
	});

	test("takes inquiries with no visible artist, not when every visible one is closed, again once one opens", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("page-open-44");
		const accepting = () =>
			inTenant(
				tenant,
				async () => (await pagesWith().studio(tenant)).acceptingInquiries,
			);

		assert.isTrue(await accepting());
		await addArtist(tenant, owner, { acceptingInquiries: false });
		assert.isFalse(await accepting());
		// A hidden artist doesn't open the studio, even one who accepts.
		await addArtist(tenant, owner, {
			name: "Hidden",
			slug: "hidden",
			visible: false,
		});
		assert.isFalse(await accepting());
		await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		assert.isTrue(await accepting());
	});

	test("makes one artist query per call: studio, list and one artist", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("page-once-44");
		await addArtist(tenant, owner);
		await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		const counting = new CountingArtists(images);

		await inTenant(tenant, () => pagesWith(counting).studio(tenant));
		assert.deepEqual([counting.reads, counting.slugReads], [1, 0]);

		await inTenant(tenant, () => pagesWith(counting).visibleArtists(tenant));
		assert.deepEqual([counting.reads, counting.slugReads], [2, 0]);

		await inTenant(tenant, () =>
			pagesWith(counting).visibleArtist(tenant, "bina"),
		);
		assert.deepEqual([counting.reads, counting.slugReads], [2, 1]);

		await inTenant(tenant, () =>
			pagesWith(counting).visibleArtist(tenant, "nobody"),
		);
		assert.deepEqual([counting.reads, counting.slugReads], [2, 2]);
	});
});

test.group("StudioPageService.visibleArtists", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists visible artists by name with only their public fields; a closed message only while closed", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("page-artists-44");
		const zara = await addArtist(tenant, owner, {
			name: "zara",
			slug: "zara",
			bio: "Dotwork.",
			acceptingInquiries: false,
			closedMessage: "Books open in March.",
		});
		// Open again, still holding the message of an earlier closing, and
		// linked to the owner: neither may show.
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

		const list = await inTenant(tenant, () =>
			pagesWith().visibleArtists(tenant),
		);

		assert.deepEqual(list, [
			{
				id: bina.id,
				slug: "bina",
				name: "Bina",
				bio: null,
				photo: null,
				acceptingInquiries: true,
				closedMessage: null,
				workPhotos: [],
			},
			{
				id: zara.id,
				slug: "zara",
				name: "zara",
				bio: "Dotwork.",
				photo: null,
				acceptingInquiries: false,
				closedMessage: "Books open in March.",
				workPhotos: [],
			},
		]);
	});

	test("a photo is its public URL and its size", async ({ assert }) => {
		const { owner, tenant } = await studioWithOwner("page-photo-44");
		const sita = await addArtist(tenant, owner, {
			photo: await uploadOf(await testImages.png(300, 200)),
		});

		const [shown] = await inTenant(tenant, () =>
			pagesWith().visibleArtists(tenant),
		);

		assert.deepEqual(shown.photo, {
			url: await images.url("artist_photo", sita.photoKey ?? "", tenant),
			width: 300,
			height: 200,
			variants: [],
		});
	});

	test("photos with copies cost no extra query", async ({ assert }) => {
		const plain = await studioWithOwner("page-plain-112");
		await addArtist(plain.tenant, plain.owner);
		await addArtist(plain.tenant, plain.owner, { name: "Bina", slug: "bina" });
		const wide = await studioWithOwner("page-wide-112");
		await addArtist(wide.tenant, wide.owner, {
			photo: await uploadOf(await testImages.jpeg(1000, 800)),
		});
		await addArtist(wide.tenant, wide.owner, {
			name: "Bina",
			slug: "bina",
			photo: await uploadOf(await testImages.jpeg(1000, 800)),
		});

		const without = await recordQueries(() =>
			inTenant(plain.tenant, () => pagesWith().visibleArtists(plain.tenant)),
		);
		const withCopies = await recordQueries(() =>
			inTenant(wide.tenant, () => pagesWith().visibleArtists(wide.tenant)),
		);

		assert.lengthOf(withCopies.result, 2);
		assert.lengthOf(withCopies.result[0].photo?.variants ?? [], 2);
		assert.equal(withCopies.queries.length, without.queries.length);
	});

	test("a studio with no visible artist has none", async ({ assert }) => {
		const { owner, tenant } = await studioWithOwner("page-none-44");
		await addArtist(tenant, owner, { visible: false });

		assert.deepEqual(
			await inTenant(tenant, () => pagesWith().visibleArtists(tenant)),
			[],
		);
	});
});

test.group("StudioPageService.visibleArtist", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("finds a visible artist by exact slug; hidden, deleted and unknown are null", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("page-one-44");
		const zara = await addArtist(tenant, owner, { name: "Zara", slug: "zara" });
		await addArtist(tenant, owner, {
			name: "Hidden",
			slug: "hidden",
			visible: false,
		});
		const gone = await addArtist(tenant, owner, { name: "Gone", slug: "gone" });
		await inTenant(tenant, () =>
			new ArtistService(images).delete(tenant, gone),
		);
		const pages = pagesWith();

		const found = await inTenant(tenant, async () => ({
			zara: await pages.visibleArtist(tenant, "zara"),
			hidden: await pages.visibleArtist(tenant, "hidden"),
			gone: await pages.visibleArtist(tenant, "gone"),
			nobody: await pages.visibleArtist(tenant, "nobody"),
			cased: await pages.visibleArtist(tenant, "Zara"),
		}));

		assert.equal(found.zara?.id, zara.id);
		assert.isNull(found.hidden);
		assert.isNull(found.gone);
		assert.isNull(found.nobody);
		assert.isNull(found.cased);
	});
});

test.group("StudioPageService: cover and work photos (TAT-116)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the cover is the tenant row's image with its copies, and costs no query of its own", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("page-cover-116");
		const withCover = await inTenant(tenant, async () =>
			new TenancyService(undefined, images).setCover(
				tenant,
				await uploadOf(await testImages.jpeg(2048, 1536)),
			),
		);

		const { result, queries } = await recordQueries(() =>
			inTenant(tenant, () => pagesWith().studio(withCover)),
		);

		assert.deepEqual(result.cover, {
			url: await images.url(
				"studio_cover",
				withCover.coverImageKey ?? "",
				tenant,
			),
			width: 2048,
			height: 1536,
			variants: await images.variants(
				"studio_cover",
				withCover.coverImageKey ?? "",
				tenant,
			),
		});
		assert.deepEqual(
			result.cover?.variants.map((copy) => copy.width),
			[640, 960, 1280, 1600],
		);
		// Only the artists read: the cover comes from the row already loaded.
		assert.lengthOf(
			queries.filter((sql) => /from "?artists"?/.test(sql)),
			1,
		);
		assert.lengthOf(
			queries.filter((sql) => sql.includes("artist_work_photos")),
			0,
		);
	});

	test("a studio without a cover has cover null", async ({ assert }) => {
		const { tenant } = await studioWithOwner("page-nocover-116");

		const page = await inTenant(tenant, () => pagesWith().studio(tenant));

		assert.isNull(page.cover);
	});

	test("an artist's work photos come in the studio's order with only their public fields", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("page-work-116");
		const sita = await addArtist(tenant, owner);
		await inTenant(tenant, async () => {
			await addWorkPhoto(tenant, sita, { alt: "Koi on the forearm" });
			await addWorkPhoto(tenant, sita, { width: 300, height: 400 });
		});

		const [shown] = await inTenant(tenant, () =>
			pagesWith().visibleArtists(tenant),
		);
		const one = await inTenant(tenant, () =>
			pagesWith().visibleArtist(tenant, "sita"),
		);

		assert.lengthOf(shown.workPhotos, 2);
		assert.deepEqual(
			shown.workPhotos.map((photo) => photo.alt),
			["Koi on the forearm", null],
		);
		assert.deepEqual(Object.keys(shown.workPhotos[0]).sort(), [
			"alt",
			"height",
			"url",
			"variants",
			"width",
		]);
		assert.deepEqual(
			shown.workPhotos[0].variants.map((copy) => copy.width),
			[320, 640, 1280],
		);
		assert.deepEqual(one?.workPhotos, shown.workPhotos);
	});

	test("a closed artist still shows their work; a hidden or deleted artist's photos are never read", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("page-closed-116");
		const closed = await addArtist(tenant, owner, {
			name: "Closed",
			slug: "closed",
			acceptingInquiries: false,
			closedMessage: "Books open in March.",
		});
		const hidden = await addArtist(tenant, owner, {
			name: "Hidden",
			slug: "hidden",
			visible: false,
		});
		const gone = await addArtist(tenant, owner, { name: "Gone", slug: "gone" });
		await inTenant(tenant, async () => {
			await addWorkPhoto(tenant, closed, { alt: "closed-photo" });
			await addWorkPhoto(tenant, hidden, { alt: "hidden-photo" });
			await addWorkPhoto(tenant, gone, { alt: "gone-photo" });
			await new ArtistService(images).delete(tenant, gone);
		});

		const list = await inTenant(tenant, () =>
			pagesWith().visibleArtists(tenant),
		);

		assert.deepEqual(
			list.map((artist) => artist.slug),
			["closed"],
		);
		assert.deepEqual(
			list[0].workPhotos.map((photo) => photo.alt),
			["closed-photo"],
		);
		assert.notInclude(JSON.stringify(list), "hidden-photo");
		assert.notInclude(JSON.stringify(list), "gone-photo");
	});

	test("a list costs two queries (artists, then every artist's photos), one artist two, none extra for a studio", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("page-count-116");
		for (const [slug, name] of [
			["sita", "Sita"],
			["bina", "Bina"],
			["mira", "Mira"],
		]) {
			const artist = await addArtist(tenant, owner, { name, slug });
			await inTenant(tenant, async () => {
				await addWorkPhoto(tenant, artist);
				await addWorkPhoto(tenant, artist);
			});
		}
		const empty = await studioWithOwner("page-count-empty-116");
		// The context's own statements (savepoint, settings) cost the same
		// whatever runs inside, so an empty one is the baseline to subtract.
		const baseline = (
			await recordQueries(() => inTenant(tenant, async () => {}))
		).queries.length;
		const queries = async <T>(who: { tenant: Tenant }, fn: () => Promise<T>) =>
			(await recordQueries(() => inTenant(who.tenant, fn))).queries.length -
			baseline;

		assert.equal(
			await queries({ tenant }, () => pagesWith().studio(tenant)),
			1,
			"studio",
		);
		assert.equal(
			await queries({ tenant }, () => pagesWith().visibleArtists(tenant)),
			2,
			"list of three artists with six photos",
		);
		assert.equal(
			await queries({ tenant }, () =>
				pagesWith().visibleArtist(tenant, "bina"),
			),
			2,
			"one artist",
		);
		assert.equal(
			await queries({ tenant }, () =>
				pagesWith().visibleArtist(tenant, "nobody"),
			),
			1,
			"an unknown slug reads no photos",
		);
		assert.equal(
			await queries(empty, () => pagesWith().visibleArtists(empty.tenant)),
			1,
			"no visible artist reads no photos",
		);
	});
});

test.group("StudioPageService: page look and logo (TAT-56)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the saved look and the logo come from the tenant row and cost no query of their own", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("page-look-56");
		const tenancy = new TenancyService(undefined, images);
		await inTenant(tenant, () =>
			tenancy.updateLook(tenant, {
				theme: "stencil-and-ink",
				accent: "#0f766e",
				accentDark: null,
				font: "sans",
				artists: "last",
			}),
		);
		const withLogo = await inTenant(tenant, async () =>
			tenancy.setLogo(tenant, await uploadOf(await testImages.png(600, 200))),
		);

		const { result, queries } = await recordQueries(() =>
			inTenant(tenant, () => pagesWith().studio(withLogo)),
		);

		assert.deepEqual(result.storefront.look, {
			theme: "stencil-and-ink",
			accent: "#0f766e",
			accentDark: null,
			font: "sans",
			sections: ["inquiry", "artists"],
		});
		assert.deepEqual(result.storefront.logo, {
			url: await images.url("studio_logo", withLogo.logoImageKey ?? "", tenant),
			width: 600,
			height: 200,
			variants: await images.variants(
				"studio_logo",
				withLogo.logoImageKey ?? "",
				tenant,
			),
		});
		assert.deepEqual(
			result.storefront.logo?.variants.map((copy) => copy.width),
			[320],
		);
		// Only the artists read: the look and the logo come from the row already loaded.
		assert.lengthOf(
			queries.filter((sql) => /from "?artists"?/.test(sql)),
			1,
		);
		assert.lengthOf(
			queries.filter((sql) => /from "?tenants"?/.test(sql)),
			0,
		);
	});

	test("a studio that set nothing has the default look and no logo", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("page-nolook-56");

		const page = await inTenant(tenant, () => pagesWith().studio(tenant));

		assert.deepEqual(page.storefront, { look: DEFAULT_LOOK, logo: null });
	});

	test("a half-set logo (no size) is no logo", async ({ assert }) => {
		const { tenant } = await studioWithOwner("page-halflogo-56");
		const half = Object.assign(tenant, { logoImageKey: "tenants/x/k.png" });

		const page = await inTenant(tenant, () => pagesWith().studio(half));

		assert.isNull(page.storefront.logo);
	});
});
