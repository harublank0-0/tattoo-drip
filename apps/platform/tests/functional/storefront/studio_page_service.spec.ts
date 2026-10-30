import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ArtistService from "#modules/artists/services/artist_service";
import WorkPhotoService from "#modules/artists/services/work_photo_service";
import FlashService from "#modules/flash/services/flash_service";
import ImageService from "#modules/media/services/image_service";
import OpeningHoursService from "#modules/scheduling/services/opening_hours_service";
import StudioPageService, {
	type FlashQuery,
	type WorkQuery,
} from "#modules/storefront/services/studio_page_service";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService, {
	type TenantProfile,
} from "#modules/tenancy/services/tenancy_service";
import {
	addArtist,
	addFlashDesign,
	addWorkPhoto,
} from "#tests/helpers/artists";
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
	new StudioPageService(
		artists,
		images,
		new WorkPhotoService(images, artists),
		new OpeningHoursService(),
		new FlashService(images, artists),
	);

/** The look of a studio that set nothing (TAT-56). */
const DEFAULT_LOOK = {
	theme: "stencil-and-ink",
	accent: null,
	accentDark: null,
	font: "eczar",
	sections: ["work", "artists", "info", "inquiry"],
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
			openingHours: [],
			closedDays: [],
			goodToKnow: {
				walkIns: null,
				ageRule: null,
				depositPolicy: null,
				beforeSession: null,
				aftercare: null,
			},
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
				styles: [],
				socialLinks: [],
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
				styles: [],
				socialLinks: [],
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

	test("an artist's work photos come newest first with only their public fields", async ({
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
			[null, "Koi on the forearm"],
		);
		assert.deepEqual(Object.keys(shown.workPhotos[0]).sort(), [
			"alt",
			"height",
			"url",
			"variants",
			"width",
		]);
		assert.deepEqual(
			shown.workPhotos[1].variants.map((copy) => copy.width),
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
			3,
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
				sections: ["inquiry", "artists"],
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

test.group("StudioPageService.work (TAT-126)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const everything: WorkQuery = {
		artist: null,
		style: null,
		healed: false,
		cursor: null,
		limit: 24,
	};
	const time = (minutes: number) =>
		DateTime.fromISO("2026-10-01T10:00:00.000Z", { zone: "utc" }).plus({
			minutes,
		});

	test("work names each photo's artist and orders the filters' styles as the list does", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("page-work-126a");
		const zara = await addArtist(tenant, owner, { name: "Zara", slug: "zara" });
		const bina = await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		const [older, newer] = await inTenant(tenant, async () => [
			await addWorkPhoto(tenant, zara, {
				createdAt: time(1),
				alt: "Koi",
				// Stored out of the list's order, with one that left the list.
				styles: ["cover-up", "retired-style", "blackwork"],
				healed: true,
			}),
			await addWorkPhoto(tenant, bina, {
				createdAt: time(2),
				styles: ["realism"],
			}),
		]);

		const page = await inTenant(tenant, () =>
			pagesWith().work(tenant, everything),
		);

		assert.deepEqual(
			page.photos.map((photo) => photo.artist),
			[
				{ slug: "bina", name: "Bina" },
				{ slug: "zara", name: "Zara" },
			],
		);
		assert.deepEqual(page.photos[0].styles, [
			{ slug: "realism", name: "Realism" },
		]);
		assert.isFalse(page.photos[0].healed);
		assert.deepEqual(page.photos[1].styles, [
			{ slug: "blackwork", name: "Blackwork" },
			{ slug: "cover-up", name: "Cover-up" },
		]);
		assert.isTrue(page.photos[1].healed);
		assert.equal(page.photos[1].alt, "Koi");
		assert.deepEqual(
			page.photos.map((photo) => photo.url),
			[
				await images.url("artist_work_photo", newer.imageKey, tenant),
				await images.url("artist_work_photo", older.imageKey, tenant),
			],
		);
		assert.deepEqual(
			page.photos[1].variants.map((copy) => copy.width),
			[320, 640, 1280],
		);
		assert.isNull(page.nextCursor);
		assert.deepEqual(page.filters, {
			styles: [
				{ slug: "blackwork", name: "Blackwork" },
				{ slug: "realism", name: "Realism" },
				{ slug: "cover-up", name: "Cover-up" },
			],
			healed: true,
		});
		// The photos carry only the shown fields, not the row or its cursor.
		assert.deepEqual(Object.keys(page.photos[0]).sort(), [
			"alt",
			"artist",
			"healed",
			"height",
			"styles",
			"url",
			"variants",
			"width",
		]);
	});

	test("an artist narrows the page and its filters; one who is not visible, or not there, is an empty page and no photo query", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("page-work-126b");
		const zara = await addArtist(tenant, owner, { name: "Zara", slug: "zara" });
		const bina = await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		const hidden = await addArtist(tenant, owner, {
			name: "Hidden",
			slug: "hidden",
			visible: false,
		});
		await inTenant(tenant, async () => {
			await addWorkPhoto(tenant, zara, { styles: ["realism"], healed: true });
			await addWorkPhoto(tenant, bina, { styles: ["japanese"] });
			await addWorkPhoto(tenant, hidden, { styles: ["cover-up"] });
		});
		const work = (query: Partial<WorkQuery>) =>
			recordQueries(() =>
				inTenant(tenant, () =>
					pagesWith().work(tenant, { ...everything, ...query }),
				),
			);

		const justBina = await work({ artist: "bina" });
		const noOne = await work({ artist: "nobody" });
		const hiddenOne = await work({ artist: "hidden" });
		const cased = await work({ artist: "Bina" });

		assert.deepEqual(
			justBina.result.photos.map((photo) => photo.artist.slug),
			["bina"],
		);
		assert.deepEqual(justBina.result.filters, {
			styles: [{ slug: "japanese", name: "Japanese" }],
			healed: false,
		});
		for (const none of [noOne, hiddenOne, cased]) {
			assert.deepEqual(none.result, {
				photos: [],
				nextCursor: null,
				filters: { styles: [], healed: false },
			});
			assert.lengthOf(
				none.queries.filter((sql) => sql.includes("artist_work_photos")),
				0,
			);
		}
	});

	test("a listed style the request asked for stays in the filters when the chosen artist has none of it, so the controls show the filtering", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("page-work-126e");
		const a = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
		const b = await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		await inTenant(tenant, async () => {
			await addWorkPhoto(tenant, a, { styles: ["blackwork"] });
			await addWorkPhoto(tenant, b, { styles: ["fine-line"], healed: true });
		});
		const blackwork = { slug: "blackwork", name: "Blackwork" };
		const fineLine = { slug: "fine-line", name: "Fine line" };
		const work = (query: Partial<WorkQuery>) =>
			inTenant(tenant, () =>
				pagesWith().work(tenant, { ...everything, ...query }),
			);

		const lacking = await work({ artist: "asha", style: "fine-line" });
		const carried = await work({ artist: "bina", style: "fine-line" });
		const unfiltered = await work({});
		const nobody = await work({ artist: "nobody", style: "fine-line" });

		// An empty page, and the filters the artist's own plus the style asked for, in the list's order.
		assert.deepEqual(lacking.photos, []);
		assert.isNull(lacking.nextCursor);
		assert.deepEqual(lacking.filters, {
			styles: [blackwork, fineLine],
			healed: false,
		});
		// A style the artist does carry is there once.
		assert.lengthOf(carried.photos, 1);
		assert.deepEqual(carried.filters, { styles: [fineLine], healed: true });
		// No style asked for: the facets alone.
		assert.deepEqual(unfiltered.filters, {
			styles: [blackwork, fineLine],
			healed: true,
		});
		// No visible artist by that slug: nothing to filter, but the control still shows its style.
		assert.deepEqual(nobody, {
			photos: [],
			nextCursor: null,
			filters: { styles: [fineLine], healed: false },
		});
	});

	test("reads the artists once, then one query for the page and one for the filters", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("page-work-126c");
		for (const [slug, name] of [
			["sita", "Sita"],
			["bina", "Bina"],
		]) {
			const artist = await addArtist(tenant, owner, { name, slug });
			await inTenant(tenant, async () => {
				await addWorkPhoto(tenant, artist);
				await addWorkPhoto(tenant, artist);
			});
		}
		const counting = new CountingArtists(images);
		const baseline = (
			await recordQueries(() => inTenant(tenant, async () => {}))
		).queries.length;

		const { result, queries } = await recordQueries(() =>
			inTenant(tenant, () => pagesWith(counting).work(tenant, everything)),
		);

		assert.lengthOf(result.photos, 4);
		assert.equal(counting.reads, 1);
		assert.equal(queries.length - baseline, 3, "artists, page, filters");
	});

	test("a style that is not in the list is an empty page, with the studio's filters", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("page-work-126d");
		const sita = await addArtist(tenant, owner);
		await inTenant(tenant, () =>
			addWorkPhoto(tenant, sita, { styles: ["realism", "retired-style"] }),
		);

		const retired = await inTenant(tenant, () =>
			pagesWith().work(tenant, { ...everything, style: "retired-style" }),
		);

		assert.deepEqual(retired.photos, []);
		assert.isNull(retired.nextCursor);
		assert.deepEqual(retired.filters, {
			styles: [{ slug: "realism", name: "Realism" }],
			healed: false,
		});
	});
});

test.group("StudioPageService.flash (TAT-129)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const everything: FlashQuery = { artist: null, cursor: null, limit: 24 };

	test("flash names each design's artist and orders filters.artists by name", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("page-flash-129a");
		const zara = await addArtist(tenant, owner, { name: "Zara", slug: "zara" });
		const bina = await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		await addArtist(tenant, owner, { name: "None", slug: "none" });
		const at = DateTime.fromISO("2026-10-01T10:00:00.000Z", { zone: "utc" });
		const [older, newer] = await inTenant(tenant, async () => [
			await addFlashDesign(tenant, zara, {
				name: "Moth",
				price: 300_000,
				createdAt: at.plus({ minutes: 1 }),
			}),
			await addFlashDesign(tenant, bina, {
				name: "Koi",
				createdAt: at.plus({ minutes: 2 }),
			}),
		]);

		const page = await inTenant(tenant, () =>
			pagesWith().flash(tenant, everything),
		);

		assert.deepEqual(
			page.designs.map((shown) => [shown.name, shown.artist]),
			[
				["Koi", { slug: "bina", name: "Bina" }],
				["Moth", { slug: "zara", name: "Zara" }],
			],
		);
		assert.deepEqual(page.designs[1].price, {
			amount: 300000,
			currency: "NPR",
			text: "NPR 3,000",
		});
		assert.isNull(page.designs[0].price);
		assert.isTrue(page.designs[0].requestable);
		assert.equal(
			page.designs[0].image.url,
			await images.url("flash_design", newer.imageKey, tenant),
		);
		assert.deepEqual(
			page.designs[1].image.variants.map((copy) => copy.width),
			[320, 640, 1280],
		);
		assert.isNull(page.nextCursor);
		assert.deepEqual(page.filters, {
			artists: [
				{ slug: "bina", name: "Bina" },
				{ slug: "zara", name: "Zara" },
			],
		});
		assert.deepEqual(Object.keys(page.designs[0]).sort(), [
			"artist",
			"id",
			"image",
			"name",
			"price",
			"requestable",
			"size",
		]);
		const one = await inTenant(tenant, () =>
			pagesWith().flashDesign(tenant, older.id),
		);
		assert.deepEqual(one, page.designs[1]);
		assert.isNull(
			await inTenant(tenant, () =>
				pagesWith().flashDesign(tenant, "0199f000-0000-7000-8000-000000000001"),
			),
		);
	});

	test("an artist who is not visible, or not there, is an empty page and no design query", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("page-flash-129b");
		const sita = await addArtist(tenant, owner);
		await addArtist(tenant, owner, {
			name: "Hidden",
			slug: "hidden",
			visible: false,
		});
		await inTenant(tenant, () => addFlashDesign(tenant, sita));

		const { result, queries } = await recordQueries(() =>
			inTenant(tenant, () =>
				pagesWith().flash(tenant, { ...everything, artist: "hidden" }),
			),
		);

		assert.deepEqual(result.designs, []);
		assert.isNull(result.nextCursor);
		assert.deepEqual(result.filters.artists, [
			{ slug: "sita", name: "Sita Rai" },
		]);
		assert.lengthOf(
			queries.filter(
				(sql) => sql.includes("flash_designs") && !sql.includes("distinct"),
			),
			0,
		);
	});
});
