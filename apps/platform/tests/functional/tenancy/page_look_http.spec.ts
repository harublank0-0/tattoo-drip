import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import type User from "#models/user";
import {
	ARTIST_PLACEMENT_KEYS,
	FONTS,
	THEME_ACCENT,
	THEME_ACCENT_DARK,
	THEMES,
} from "#modules/storefront/look";
import Tenant from "#modules/tenancy/models/tenant";
import { studioLinks } from "#services/studio_links";
import { polyglot, testImages } from "#tests/helpers/images";
import { failDeletes } from "#tests/helpers/storage_failures";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import {
	newTempUploads,
	storedImages,
	tempUploads,
} from "#tests/helpers/uploads";
import { assertValidationError } from "#tests/helpers/validation";

const FORMAT = "Upload a JPEG, PNG or WebP image.";
const reload = (tenant: { id: string }) =>
	inTenant(tenant, () => Tenant.findOrFail(tenant.id));

/** A valid form body; each test changes what it is about. */
const BODY = {
	theme: "stencil-and-ink",
	accent: "#0f766e",
	accentDark: "#a99cff",
	font: "serif",
	artists: "last",
};

const putLook = (
	client: ApiClient,
	user: User,
	tenant: { slug: string },
	body: Record<string, unknown> = BODY,
) =>
	client
		.put(`/t/${tenant.slug}/settings/look`)
		.form(body)
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);

const lookPage = (client: ApiClient, user: User, tenant: { slug: string }) =>
	client.get(`/t/${tenant.slug}/settings/look`).withInertia().loginAs(user);

test.group("Settings, Page look: the page (TAT-56)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner opens it with the stored look, the server's lists and no key of any image", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await lookPage(client, owner, tenant);

		response.assertStatus(200);
		response.assertInertiaComponent("settings/look");
		const props = response.inertiaProps;
		assert.deepEqual(props.look, {
			theme: "stencil-and-ink",
			accent: null,
			accentDark: null,
			font: "eczar",
			artists: "first",
		});
		assert.deepEqual(props.themes, THEMES);
		assert.deepEqual(props.fonts, FONTS);
		assert.deepEqual(props.placements, ARTIST_PLACEMENT_KEYS);
		assert.deepEqual(props.swatches, {
			light: THEME_ACCENT,
			dark: THEME_ACCENT_DARK,
		});
		assert.isNull(props.logo);
		assert.isFalse(props.hasCover);
		assert.deepEqual(props.studioPage, studioLinks(tenant.slug));
		const text = JSON.stringify(props);
		for (const secret of ["logoImage", "logo_image", "coverImage"]) {
			assert.notInclude(text, secret);
		}
	});

	test("it shows what was saved, as the API serves it", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await putLook(client, owner, tenant);

		const { look } = (await lookPage(client, owner, tenant)).inertiaProps;

		assert.deepEqual(look, {
			theme: "stencil-and-ink",
			accent: "#0f766e",
			accentDark: "#a99cff",
			font: "serif",
			artists: "last",
		});
	});

	test("a stored value off today's list shows as its default", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, () =>
			Tenant.query()
				.where("id", tenant.id)
				.update({ brandFont: "mono", brandAccent: "#e8a317" }),
		);

		const { look } = (await lookPage(client, owner, tenant)).inertiaProps;

		assert.equal(look.font, "eczar");
		assert.isNull(look.accent);
	});
});

test.group("Settings, Page look: saving (TAT-56)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner saves; a colour in capitals is stored in lowercase", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await putLook(client, owner, tenant, {
			...BODY,
			accent: "#0F766E",
			accentDark: " #A99CFF ",
		});

		response.assertStatus(302);
		response.assertHeader("location", `/t/${tenant.slug}/settings/look`);
		// The sentence a real save sends, spelled out here (not the constant it comes from).
		response.assertFlashMessage(
			"success",
			"Page look saved. It can take up to 15 minutes to show on your page.",
		);
		const row = await reload(tenant);
		assert.equal(row.brandAccent, "#0f766e");
		assert.equal(row.brandAccentDark, "#a99cff");
		assert.equal(row.brandFont, "serif");
		assert.equal(row.storefrontTheme, "stencil-and-ink");
		assert.equal(row.storefrontSections, "inquiry,artists");
	});

	test("an empty colour clears the stored one", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		await putLook(client, owner, tenant);

		const response = await putLook(client, owner, tenant, {
			...BODY,
			accent: "",
			accentDark: "",
		});

		response.assertStatus(302);
		const row = await reload(tenant);
		assert.isNull(row.brandAccent);
		assert.isNull(row.brandAccentDark);
	});

	test("every artists placement is stored as its section list", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const stored: Record<string, string> = {};

		for (const artists of ARTIST_PLACEMENT_KEYS) {
			await putLook(client, owner, tenant, { ...BODY, artists });
			stored[artists] = (await reload(tenant)).storefrontSections;
		}

		assert.deepEqual(stored, {
			first: "artists,inquiry",
			last: "inquiry,artists",
			hidden: "inquiry",
		});
	});

	test("a refused value is a field error and nothing is stored", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		// True for a pale colour and for a saturated mid-tone such as red (3.62:1 on the paper), so it says
		// "hard to read", not "too light".
		const readable =
			"This colour is hard to read on your page. Pick a darker one.";
		const readableDark =
			"This colour is hard to read in dark mode. Pick a lighter one.";
		const format =
			"Type the colour as # and six letters or digits, like #0f766e.";
		const cases: [string, Record<string, unknown>, string, string][] = [
			["a light accent", { accent: "#e8a317" }, "accent", readable],
			["a grey too light", { accent: "#777777" }, "accent", readable],
			["white", { accent: "#ffffff" }, "accent", readable],
			["a mid-tone red", { accent: "#ff0000" }, "accent", readable],
			[
				"a mid-tone blue in dark mode",
				{ accentDark: "#5050ff" },
				"accentDark",
				readableDark,
			],
			[
				"a dark-mode colour too dark",
				{ accentDark: "#43389a" },
				"accentDark",
				readableDark,
			],
			["a colour name", { accent: "teal" }, "accent", format],
			["three digits", { accent: "#0f7" }, "accent", format],
			["no hash", { accent: "0f766e" }, "accent", format],
			[
				"a dark-mode colour name",
				{ accentDark: "lilac" },
				"accentDark",
				format,
			],
			[
				"markup",
				{ accent: "red;background:url(//evil.example/x)" },
				"accent",
				format,
			],
			[
				"an unknown font",
				{ font: "comic" },
				"font",
				"Choose one of the fonts.",
			],
			[
				"an unknown theme",
				{ theme: "classic" },
				"theme",
				"Choose one of the themes.",
			],
			[
				"an unknown placement",
				{ artists: "middle" },
				"artists",
				"Choose where the artists list goes.",
			],
		];

		for (const [name, change, field, message] of cases) {
			const response = await putLook(client, owner, tenant, {
				...BODY,
				...change,
			});
			assertValidationError(response, field, message);
			const row = await reload(tenant);
			assert.equal(row.brandFont, "eczar", name);
			assert.isNull(row.brandAccent, name);
			assert.isNull(row.brandAccentDark, name);
			assert.equal(row.storefrontSections, "artists,inquiry", name);
		}
	});

	test("a request that leaves a colour out gets a plain message, and nothing is stored", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const message =
			"Leave the colour empty or type it as # and six letters or digits, like #0f766e.";

		for (const field of ["accent", "accentDark"]) {
			const { [field]: _left, ...rest } = BODY as Record<string, unknown>;
			const response = await putLook(client, owner, tenant, rest);
			assertValidationError(response, field, message);
		}
		const row = await reload(tenant);
		assert.equal(row.brandFont, "eczar");
		assert.isNull(row.brandAccent);
	});

	test("the borderline colours: 4.62:1 passes, 4.05:1 does not", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		const good = await putLook(client, owner, tenant, {
			...BODY,
			accent: "#6e6e6e",
		});
		const bad = await putLook(client, owner, tenant, {
			...BODY,
			accent: "#777777",
		});

		good.assertStatus(302);
		assertValidationError(bad, "accent");
		assert.equal((await reload(tenant)).brandAccent, "#6e6e6e");
	});

	test("an artist member gets a 404 on the page and every route, and the row is unchanged", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const member = await artistIn(tenant);
		const before = (await reload(tenant)).serialize();
		const temp = await tempUploads();

		const responses = [
			await client.get(`/t/${tenant.slug}/settings/look`).loginAs(member),
			await putLook(client, member, tenant),
			await client
				.put(`/t/${tenant.slug}/settings/logo`)
				.file("logo", await testImages.png(600, 200), { filename: "logo.png" })
				.withCsrfToken()
				.loginAs(member)
				.redirects(0),
			await client
				.delete(`/t/${tenant.slug}/settings/logo`)
				.withCsrfToken()
				.loginAs(member)
				.redirects(0),
		];

		for (const response of responses) response.assertStatus(404);
		assert.deepEqual((await reload(tenant)).serialize(), before);
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.deepEqual(await newTempUploads(temp), []);
	});
});

const LOGO = "studio_logo";

const setLogo = (
	client: ApiClient,
	user: User,
	tenant: { slug: string },
	data: Buffer,
	filename = "logo.png",
) =>
	client
		.put(`/t/${tenant.slug}/settings/logo`)
		.file("logo", data, { filename })
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);

const removeLogo = (client: ApiClient, user: User, tenant: { slug: string }) =>
	client
		.delete(`/t/${tenant.slug}/settings/logo`)
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);

test.group("Settings, Page look: the logo (TAT-56)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sets, replaces and removes the logo", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		const set = await setLogo(
			client,
			owner,
			tenant,
			await testImages.png(600, 200),
		);
		set.assertStatus(302);
		set.assertHeader("location", `/t/${tenant.slug}/settings/look`);
		set.assertFlashMessage("success", "Logo saved.");
		const first = await reload(tenant);
		assert.match(
			first.logoImageKey ?? "",
			new RegExp(`^tenants/${tenant.id}/${LOGO}/`),
		);
		assert.equal(first.logoImageWidth, 600);
		assert.equal(first.logoImageHeight, 200);
		assert.lengthOf(await storedImages(tenant, LOGO), 2);

		const replaced = await setLogo(
			client,
			owner,
			tenant,
			await testImages.jpeg(900, 300),
			"logo.jpg",
		);
		replaced.assertStatus(302);
		const second = await reload(tenant);
		assert.notEqual(second.logoImageKey, first.logoImageKey);
		assert.lengthOf(await storedImages(tenant, LOGO), 3, "one logo is left");

		const removed = await removeLogo(client, owner, tenant);
		removed.assertStatus(302);
		removed.assertHeader("location", `/t/${tenant.slug}/settings/look`);
		removed.assertFlashMessage("success", "Logo removed.");
		const after = await reload(tenant);
		assert.isNull(after.logoImageKey);
		assert.isNull(after.logoImageWidth);
		assert.isNull(after.logoImageHeight);
		assert.deepEqual(await storedImages(tenant, LOGO), []);
	});

	test("the page previews the 640 copy (or the image itself when narrower) with its own size, never the key", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		await setLogo(client, owner, tenant, await testImages.png(1200, 300));

		const { logo } = (await lookPage(client, owner, tenant)).inertiaProps;

		assert.deepEqual(Object.keys(logo).sort(), [
			"height",
			"previewUrl",
			"width",
		]);
		assert.match(
			new URL(logo.previewUrl).pathname,
			new RegExp(`^/uploads/tenants/${tenant.id}/${LOGO}/.+\\.640w\\.png$`),
		);
		assert.equal(logo.width, 640);
		assert.equal(logo.height, 160);

		await setLogo(client, owner, tenant, await testImages.png(500, 250));
		const narrow = (await lookPage(client, owner, tenant)).inertiaProps.logo;
		assert.equal(narrow.width, 500);
		assert.equal(narrow.height, 250);
		assert.notMatch(narrow.previewUrl, /640w/);
	});

	test("the cover is separate: hasCover follows the cover, not the logo", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		await setLogo(client, owner, tenant, await testImages.png(600, 200));
		assert.isFalse(
			(await lookPage(client, owner, tenant)).inertiaProps.hasCover,
		);

		await client
			.put(`/t/${tenant.slug}/settings/cover`)
			.file("cover", await testImages.jpeg(2048, 1536), { filename: "c.jpg" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assert.isTrue(
			(await lookPage(client, owner, tenant)).inertiaProps.hasCover,
		);
	});

	test("studioPage.url is the studio page's link", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const { studioPage } = (await lookPage(client, owner, tenant)).inertiaProps;

		assert.deepEqual(studioPage, studioLinks(tenant.slug));
		assert.include(studioPage.url, tenant.slug);
		assert.equal(
			studioPage.shareUrl,
			`https://wa.me/?text=${encodeURIComponent(studioPage.url)}`,
		);
	});

	test("an unusable file is a field error on logo and changes nothing", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
		const cases: [string, Buffer, string, string][] = [
			["svg", svg, "logo.svg", FORMAT],
			["svg as .png", svg, "logo.png", FORMAT],
			["heic", await testImages.heif(), "logo.heic", FORMAT],
			["gif as .png", await testImages.gif(), "logo.png", FORMAT],
			[
				"49 MP png",
				await testImages.huge(),
				"logo.png",
				"This image is too large. Use one under 40 megapixels.",
			],
		];
		const temp = await tempUploads();

		for (const [name, data, filename, message] of cases) {
			const response = await setLogo(client, owner, tenant, data, filename);
			assertValidationError(response, "logo", message);
			assert.isNull((await reload(tenant)).logoImageKey, name);
			assert.deepEqual(await storedImages(tenant, LOGO), [], name);
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.deepEqual(await newTempUploads(temp), []);
	});

	test("without a file, or over 10 MB, the logo field says so", async ({
		client,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		const none = await client
			.put(`/t/${tenant.slug}/settings/logo`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		const big = await setLogo(
			client,
			owner,
			tenant,
			Buffer.alloc(11 * 1024 * 1024),
			"big.png",
		);

		assertValidationError(none, "logo", "Choose an image to upload.");
		assertValidationError(big, "logo", "Use an image of 10 MB or less.");
	});

	test("a polyglot logo is processed like any image", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		const response = await setLogo(
			client,
			owner,
			tenant,
			await polyglot(),
			"logo.jpg",
		);

		response.assertStatus(302);
		assert.isNotNull((await reload(tenant)).logoImageKey);
	});

	test("removing when there is no logo is still a redirect", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		const response = await removeLogo(client, owner, tenant);

		response.assertStatus(302);
		assert.isNull((await reload(tenant)).logoImageKey);
	});

	test("a removal that can't delete the files keeps the logo with an error note; the retry removes it", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		await setLogo(client, owner, tenant, await testImages.png(600, 200));
		const key = (await reload(tenant)).logoImageKey;
		const failing = failDeletes("public", () => true);

		let refused: Awaited<ReturnType<typeof removeLogo>>;
		try {
			refused = await removeLogo(client, owner, tenant);
		} finally {
			failing.restore();
		}

		refused.assertStatus(302);
		refused.assertHeader("location", `/t/${tenant.slug}/settings/look`);
		refused.assertFlashMessage("error", "Couldn't remove the logo, try again.");
		assert.equal((await reload(tenant)).logoImageKey, key);

		const retry = await removeLogo(client, owner, tenant);
		retry.assertFlashMessage("success", "Logo removed.");
		assert.isNull((await reload(tenant)).logoImageKey);
		assert.deepEqual(await storedImages(tenant, LOGO), []);
	});
});
