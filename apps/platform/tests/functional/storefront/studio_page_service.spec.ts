import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import StudioPageService from "#modules/storefront/services/studio_page_service";
import TenancyService, {
	type TenantProfile,
} from "#modules/tenancy/services/tenancy_service";
import { addArtist } from "#tests/helpers/artists";
import { testImages, uploadOf } from "#tests/helpers/images";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/** Counts listVisible calls, so a test sees the artists read once per call. */
class CountingArtists extends ArtistService {
	reads = 0;

	override async listVisible(
		...args: Parameters<ArtistService["listVisible"]>
	) {
		this.reads++;
		return super.listVisible(...args);
	}
}

const images = new ImageService();
const pagesWith = (artists: ArtistService = new ArtistService(images)) =>
	new StudioPageService(artists, images);

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

	test("reads the artists once per call", async ({ assert }) => {
		const { owner, tenant } = await studioWithOwner("page-once-44");
		await addArtist(tenant, owner);
		await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		const counting = new CountingArtists(images);

		await inTenant(tenant, () => pagesWith(counting).studio(tenant));
		await inTenant(tenant, () => pagesWith(counting).visibleArtists(tenant));

		assert.equal(counting.reads, 2);
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
			},
			{
				id: zara.id,
				slug: "zara",
				name: "zara",
				bio: "Dotwork.",
				photo: null,
				acceptingInquiries: false,
				closedMessage: "Books open in March.",
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
		});
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
