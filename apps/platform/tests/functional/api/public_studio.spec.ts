import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import OpeningHoursService from "#modules/scheduling/services/opening_hours_service";
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
	"closedDays",
	"contact",
	"cover",
	"goodToKnow",
	"intro",
	"name",
	"openingHours",
	"slug",
	"socialLinks",
	"storefront",
	"timezone",
	"type",
];
const CONTACT_FIELDS = ["address", "email", "phone"];
const GOOD_TO_KNOW_FIELDS = [
	"aftercare",
	"ageRule",
	"beforeSession",
	"depositPolicy",
	"walkIns",
];
const CLOSED_DAY_FIELDS = ["from", "note", "to"];
const HOURS_FIELDS = ["closes", "day", "opens"];
const LINK_FIELDS = ["platform", "url"];

/** The page look of a studio that set nothing (openapi.yaml, StorefrontConfiguration; TAT-56). */
const DEFAULT_STOREFRONT = {
	theme: "stencil-and-ink",
	branding: {
		logo: null,
		colors: { accent: null, accentDark: null },
		font: "eczar",
	},
	sections: [
		{ type: "work" },
		{ type: "artists" },
		{ type: "flash" },
		{ type: "info" },
		{ type: "inquiry" },
	],
};

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

/** What a studio that wrote none of the Good to know texts answers (TAT-128). */
const EMPTY_GOOD_TO_KNOW = {
	walkIns: null,
	ageRule: null,
	depositPolicy: null,
	beforeSession: null,
	aftercare: null,
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
	storefront: DEFAULT_STOREFRONT,
	openingHours: [],
	closedDays: [],
	goodToKnow: EMPTY_GOOD_TO_KNOW,
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
			storefront: DEFAULT_STOREFRONT,
			openingHours: [],
			closedDays: [],
			goodToKnow: EMPTY_GOOD_TO_KNOW,
		});
		assertApiHeaders(response);
	});

	test("has exactly the documented fields", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner("api-fields-44");
		await inTenant(tenant, () => tenancy.updateProfile(tenant, PROFILE));

		const { data } = (await client.get("/api/v1/tenants/api-fields-44")).body();

		assert.deepEqual(Object.keys(data).sort(), STUDIO_FIELDS);
		assert.deepEqual(Object.keys(data.contact).sort(), CONTACT_FIELDS);
		assert.deepEqual(Object.keys(data.goodToKnow).sort(), GOOD_TO_KNOW_FIELDS);
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

	test("one studio's ETag never earns a 304 under another's slug (TAT-16)", async ({
		client,
		assert,
	}) => {
		await studioWithOwner("api-etag-a-16", "Etag A");
		await studioWithOwner("api-etag-b-16", "Etag B");
		const a = await client.get("/api/v1/tenants/api-etag-a-16");
		const tag = a.header("etag") ?? "";
		assert.isNotEmpty(tag);

		const elsewhere = await client
			.get("/api/v1/tenants/api-etag-b-16")
			.header("if-none-match", tag);
		const own = await client
			.get("/api/v1/tenants/api-etag-a-16")
			.header("if-none-match", tag);

		elsewhere.assertStatus(200);
		assert.equal(elsewhere.body().data.name, "Etag B");
		assert.notEqual(elsewhere.header("etag"), tag);
		// The control: the same tag under its own slug is a 304.
		own.assertStatus(304);
	});

	test("a studio that set nothing has no hours, no closed days and empty Good to know", async ({
		client,
		assert,
	}) => {
		await studioWithOwner("api-know-empty-128");

		const { data } = (
			await client.get("/api/v1/tenants/api-know-empty-128")
		).body();

		assert.deepEqual(data.openingHours, []);
		assert.deepEqual(data.closedDays, []);
		assert.deepEqual(data.goodToKnow, EMPTY_GOOD_TO_KNOW);
	});

	test("hours, upcoming closed days and the texts are served; an ended closure is not", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-know-128");
		const hours = new OpeningHoursService();
		const today = DateTime.now().setZone("Asia/Kathmandu");
		const day = (days: number) => today.plus({ days }).toFormat("yyyy-MM-dd");
		await inTenant(tenant, async () => {
			// Saved out of order: the answer is Sunday first.
			await hours.replaceWeek(tenant, [
				{ day: "sat", opens: "10:30", closes: "17:00" },
				{ day: "sun", opens: "11:00", closes: "20:00" },
			]);
			await hours.addClosure(
				tenant,
				{ startsOn: day(9), endsOn: day(10), note: "दशैं बिदा" },
				day(0),
			);
			await hours.addClosure(
				tenant,
				{ startsOn: day(3), endsOn: day(3), note: null },
				day(0),
			);
			await hours.addClosure(
				tenant,
				{ startsOn: day(-9), endsOn: day(-8), note: "ended-closure-128" },
				day(-9),
			);
			tenant.merge({
				walkInsText: "  Small flash on Saturdays.  ",
				ageRuleText: "   ",
				beforeSessionText: "Eat well.\nBring ID.",
				aftercareText: "दिनमा दुई पटक सफा गर्नुहोस्।",
				depositPolicy: "Deposits hold your date.",
			});
			await tenant.save();
		});

		const response = await client.get("/api/v1/tenants/api-know-128");

		response.assertStatus(200);
		const { data } = response.body();
		assert.deepEqual(data.openingHours, [
			{ day: "sun", opens: "11:00", closes: "20:00" },
			{ day: "sat", opens: "10:30", closes: "17:00" },
		]);
		assert.deepEqual(data.closedDays, [
			{ from: day(3), to: day(3), note: null },
			{ from: day(9), to: day(10), note: "दशैं बिदा" },
		]);
		assert.deepEqual(data.goodToKnow, {
			walkIns: "Small flash on Saturdays.",
			ageRule: null,
			depositPolicy: "Deposits hold your date.",
			beforeSession: "Eat well.\nBring ID.",
			aftercare: "दिनमा दुई पटक सफा गर्नुहोस्।",
		});
		for (const closure of data.closedDays) {
			assert.deepEqual(Object.keys(closure).sort(), CLOSED_DAY_FIELDS);
		}
		for (const open of data.openingHours) {
			assert.deepEqual(Object.keys(open).sort(), HOURS_FIELDS);
		}
		assert.notInclude(JSON.stringify(data), "ended-closure-128");
	});

	test("a whitespace-only deposit policy is null, and the percentage is never in the answer", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-policy-128");
		await inTenant(tenant, () =>
			new TenancyService().updateDepositSettings(tenant, {
				defaultDepositPercent: 37,
				depositPolicy: " \n ",
			}),
		);

		const { data } = (
			await client.get("/api/v1/tenants/api-policy-128")
		).body();

		assert.isNull(data.goodToKnow.depositPolicy);
		assert.notProperty(data, "defaultDepositPercent");
		assert.notInclude(JSON.stringify(data), "37");
	});

	test("saving the hours changes the ETag", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner("api-know-etag-128");
		const before =
			(await client.get("/api/v1/tenants/api-know-etag-128")).header("etag") ??
			"";
		assert.isNotEmpty(before);

		await inTenant(tenant, () =>
			new OpeningHoursService().replaceWeek(tenant, [
				{ day: "mon", opens: "11:00", closes: "20:00" },
			]),
		);
		const after = await client
			.get("/api/v1/tenants/api-know-etag-128")
			.header("if-none-match", before);

		after.assertStatus(200);
		assert.notEqual(after.header("etag"), before);
		assert.lengthOf(after.body().data.openingHours, 1);
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

	test("has exactly the documented storefront fields", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-look-fields-56");
		await inTenant(tenant, async () =>
			tenancy.setLogo(tenant, await uploadOf(await testImages.png(600, 200))),
		);

		const { data } = (
			await client.get("/api/v1/tenants/api-look-fields-56")
		).body();

		assert.deepEqual(Object.keys(data.storefront).sort(), [
			"branding",
			"sections",
			"theme",
		]);
		assert.deepEqual(Object.keys(data.storefront.branding).sort(), [
			"colors",
			"font",
			"logo",
		]);
		assert.deepEqual(Object.keys(data.storefront.branding.colors).sort(), [
			"accent",
			"accentDark",
		]);
		for (const section of data.storefront.sections) {
			assert.deepEqual(Object.keys(section), ["type"]);
		}
	});

	test("a saved look is served as storefront", async ({ client }) => {
		const { tenant } = await studioWithOwner("api-look-56");
		await inTenant(tenant, () =>
			tenancy.updateLook(tenant, {
				theme: "stencil-and-ink",
				accent: "#0f766e",
				accentDark: "#a99cff",
				font: "serif",
				sections: ["inquiry"],
				claimedFlash: "show",
			}),
		);

		assertApiData(await client.get("/api/v1/tenants/api-look-56"), {
			...bareStudio("api-look-56", "Black Needle"),
			storefront: {
				theme: "stencil-and-ink",
				branding: {
					logo: null,
					colors: { accent: "#0f766e", accentDark: "#a99cff" },
					font: "serif",
				},
				sections: [{ type: "inquiry" }],
			},
		});
	});

	test("the artists list can come after the form", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-look-order-56");
		await inTenant(tenant, () =>
			tenancy.updateLook(tenant, {
				theme: "stencil-and-ink",
				accent: null,
				accentDark: null,
				font: "eczar",
				sections: ["inquiry", "artists"],
				claimedFlash: "show",
			}),
		);

		const { data } = (
			await client.get("/api/v1/tenants/api-look-order-56")
		).body();

		assert.deepEqual(data.storefront.sections, [
			{ type: "inquiry" },
			{ type: "artists" },
		]);
	});

	test("the logo is its public URL, its size, alt null and its copies, in the studio's own folder", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-logo-56");
		const withLogo = await inTenant(tenant, async () =>
			tenancy.setLogo(tenant, await uploadOf(await testImages.png(600, 200))),
		);
		const url = await images.url(
			"studio_logo",
			withLogo.logoImageKey ?? "",
			tenant,
		);

		const { data } = (await client.get("/api/v1/tenants/api-logo-56")).body();
		const logo = data.storefront.branding.logo;

		assert.deepEqual(Object.keys(logo).sort(), [
			"alt",
			"height",
			"icon",
			"tile",
			"url",
			"variants",
			"width",
		]);
		assert.equal(logo.url, url);
		assert.equal(logo.width, 600);
		assert.equal(logo.height, 200);
		assert.isNull(logo.alt);
		assert.deepEqual(
			logo.variants.map((variant: { width: number }) => variant.width),
			[320],
		);
		for (const variant of logo.variants) {
			assert.deepEqual(Object.keys(variant).sort(), ["url", "width"]);
			assert.equal(new URL(variant.url).origin, new URL(url).origin);
			assert.match(
				new URL(variant.url).pathname,
				new RegExp(`^/uploads/tenants/${tenant.id}/studio_logo/`),
			);
			(await client.get(new URL(variant.url).pathname)).assertStatus(200);
		}
		// The stored key and the tenant row's columns never show.
		const text = JSON.stringify(data);
		assert.notInclude(text, "logo_image");
		assert.notInclude(text, "logoImage");
		assert.notInclude(text, "logo_icon");
		assert.notInclude(text, "logoIcon");
		assert.isNull(data.cover, "the logo is not the cover");
	});

	test("the logo's tile and its square icon (TAT-123)", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-icon-123");
		const withLogo = await inTenant(tenant, async () =>
			tenancy.setLogo(tenant, await uploadOf(await testImages.png(600, 200))),
		);
		const iconUrl = await images.url(
			"studio_icon",
			withLogo.logoIconKey ?? "",
			tenant,
		);

		const { data } = (await client.get("/api/v1/tenants/api-icon-123")).body();
		const { tile, icon } = data.storefront.branding.logo;

		assert.equal(tile, "light");
		assert.deepEqual(Object.keys(icon).sort(), [
			"alt",
			"height",
			"url",
			"variants",
			"width",
		]);
		assert.equal(icon.url, iconUrl);
		assert.deepEqual([icon.width, icon.height], [180, 180]);
		assert.isNull(icon.alt);
		assert.deepEqual(
			icon.variants.map((variant: { width: number }) => variant.width),
			[32],
		);
		for (const url of [
			icon.url,
			...icon.variants.map((v: { url: string }) => v.url),
		]) {
			assert.equal(
				new URL(url).origin,
				new URL(data.storefront.branding.logo.url).origin,
			);
			assert.match(
				new URL(url).pathname,
				new RegExp(`^/uploads/tenants/${tenant.id}/studio_icon/`),
			);
			(await client.get(new URL(url).pathname)).assertStatus(200);
		}
		for (const variant of icon.variants) {
			assert.deepEqual(Object.keys(variant).sort(), ["url", "width"]);
		}
	});

	test("a white logo with a see-through background is served on the dark tile", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-darktile-123");
		await inTenant(tenant, async () =>
			tenancy.setLogo(
				tenant,
				await uploadOf(
					await testImages.logoOnClear([{ r: 255, g: 255, b: 255 }]),
				),
			),
		);

		const { data } = (
			await client.get("/api/v1/tenants/api-darktile-123")
		).body();

		assert.equal(data.storefront.branding.logo.tile, "dark");
	});

	test("an owner's switch is served, and a logo without an icon serves icon null", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-switch-123");
		// A logo saved before TAT-123: no icon, the default tile.
		await inTenant(tenant, async () => {
			tenant.merge({
				logoImageKey: `tenants/${tenant.id}/studio_logo/${randomUUID()}.320.png`,
				logoImageWidth: 600,
				logoImageHeight: 200,
			});
			await tenant.save();
		});

		const before = (await client.get("/api/v1/tenants/api-switch-123")).body()
			.data.storefront.branding.logo;
		await inTenant(tenant, () => tenancy.setLogoTile(tenant, "dark"));
		const after = (await client.get("/api/v1/tenants/api-switch-123")).body()
			.data.storefront.branding.logo;

		assert.deepEqual([before.tile, before.icon], ["light", null]);
		assert.deepEqual([after.tile, after.icon], ["dark", null]);
	});

	test("a stored tile the contract does not list is served as light", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-oddtile-123");
		await inTenant(tenant, async () => {
			tenant.merge({
				logoImageKey: `tenants/${tenant.id}/studio_logo/${randomUUID()}.320.png`,
				logoImageWidth: 600,
				logoImageHeight: 200,
				logoTile: "accent",
			});
			await tenant.save();
		});

		const { data } = (
			await client.get("/api/v1/tenants/api-oddtile-123")
		).body();

		assert.equal(data.storefront.branding.logo.tile, "light");
	});

	test("saving the look, or the logo, changes the ETag; the cache headers stay", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-looketag-56");
		const url = "/api/v1/tenants/api-looketag-56";
		const bare = await client.get(url);
		bare.assertHeader("cache-control", CACHED);
		const bareTag = bare.header("etag") ?? "";

		await inTenant(tenant, () =>
			tenancy.updateLook(tenant, {
				theme: "stencil-and-ink",
				accent: "#0f766e",
				accentDark: null,
				font: "eczar",
				sections: ["work", "artists", "inquiry"],
				claimedFlash: "show",
			}),
		);
		const saved = await client.get(url).header("if-none-match", bareTag);
		saved.assertStatus(200);
		saved.assertHeader("cache-control", CACHED);
		const savedTag = saved.header("etag") ?? "";
		assert.notEqual(savedTag, bareTag);

		await inTenant(tenant, async () =>
			tenancy.setLogo(tenant, await uploadOf(await testImages.png(600, 200))),
		);
		const withLogo = await client.get(url).header("if-none-match", savedTag);
		withLogo.assertStatus(200);
		assert.notEqual(withLogo.header("etag"), savedTag);
	});

	test("a stored value off today's list is served as its default, alone", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("api-lookdefault-56");
		await inTenant(tenant, () =>
			dbClient().rawQuery(
				`update tenants set brand_font = 'mono', storefront_theme = 'classic',
				brand_accent = '#e8a317', brand_accent_dark = '#a99cff',
				storefront_sections = 'inquiry,zzz,artists' where id = ?`,
				[tenant.id],
			),
		);

		const { data } = (
			await client.get("/api/v1/tenants/api-lookdefault-56")
		).body();

		assert.deepEqual(data.storefront, {
			theme: "stencil-and-ink",
			branding: {
				logo: null,
				// The unreadable light colour is dropped; the readable dark one stays.
				colors: { accent: null, accentDark: "#a99cff" },
				font: "eczar",
			},
			sections: [{ type: "inquiry" }, { type: "artists" }],
		});
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
