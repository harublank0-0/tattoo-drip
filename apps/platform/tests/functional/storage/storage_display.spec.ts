import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import type User from "#models/user";
import Artist from "#modules/artists/models/artist";
import ImageService from "#modules/media/services/image_service";
import { formatBytes } from "#modules/storage/categories";
import type Tenant from "#modules/tenancy/models/tenant";
import { adminUser } from "#tests/helpers/admin";
import { addArtist } from "#tests/helpers/artists";
import { testImages } from "#tests/helpers/images";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Showing storage (docs/superpowers/specs/2026-11-16-storage-meter-design.md,
 * What people see): a shared line for members' upload pages, the owner's
 * Billing section with its breakdown, and the admin's studio page.
 */
test.group("Storage meter: showing usage", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	/** A studio whose artist's photo of `width` px is stored and held. */
	async function studioWithPhoto(slug: string, width: number) {
		const { tenant, owner } = await studioWithOwner(slug, `Studio ${slug}`);
		const artist = await addArtist(tenant, owner);
		const png = await testImages.png(width, 600);
		const stored = await inTenant(tenant, () =>
			new ImageService().storeBytes(png, { tenant, purpose: "artist_photo" }),
		);
		await inTenant(tenant, () =>
			Artist.query().where("id", artist.id).update({
				photo_key: stored.key,
				photo_width: stored.width,
				photo_height: stored.height,
			}),
		);
		const bytes = Number(
			(await drive.use("public").getMetaData(stored.key)).contentLength,
		);
		return { tenant, owner, bytes };
	}

	const page = (client: ApiClient, url: string, user: User) =>
		client.get(url).loginAs(user).withInertia();

	const slugOf = (tenant: Tenant) => tenant.slug;

	test("a member's pages carry their own studio's storage line", async ({
		client,
		assert,
	}) => {
		const a = await studioWithPhoto("show-a", 800);
		const b = await studioWithPhoto("show-b", 1200);

		const portfolio = await page(
			client,
			`/t/${slugOf(a.tenant)}/portfolio`,
			a.owner,
		);
		// biome-ignore lint/suspicious/noExplicitAny: the page's shared props
		const storage = (portfolio.inertiaProps as any).storage;
		assert.equal(storage.usedText, formatBytes(a.bytes));
		assert.notEqual(storage.usedText, formatBytes(a.bytes + b.bytes));
		assert.match(storage.limitText, /^(5|25) GB$/);
		assert.isNumber(storage.percent);
		assert.isFalse(storage.enforced);
	});

	test("an artist gets the line, and the Billing page stays owners'", async ({
		client,
		assert,
	}) => {
		const s = await studioWithPhoto("show-artist", 800);
		const artist = await artistIn(s.tenant, "artist@show-artist.example");

		const portfolio = await page(
			client,
			`/t/${slugOf(s.tenant)}/portfolio`,
			artist,
		);
		assert.equal(
			// biome-ignore lint/suspicious/noExplicitAny: the page's shared props
			(portfolio.inertiaProps as any).storage.usedText,
			formatBytes(s.bytes),
		);
		(
			await client
				.get(`/t/${slugOf(s.tenant)}/settings/billing`)
				.loginAs(artist)
		).assertStatus(404);
	});

	test("the owner's Billing page breaks storage down by category", async ({
		client,
		assert,
	}) => {
		const s = await studioWithPhoto("show-billing", 800);

		const billing = await page(
			client,
			`/t/${slugOf(s.tenant)}/settings/billing`,
			s.owner,
		);
		// biome-ignore lint/suspicious/noExplicitAny: the page's props
		const detail = (billing.inertiaProps as any).storageDetail;
		assert.equal(detail.usedText, formatBytes(s.bytes));
		assert.deepEqual(
			detail.categories.map((category: { key: string; sizeText: string }) => [
				category.key,
				category.sizeText,
			]),
			[
				["portfolio", formatBytes(s.bytes)],
				["clients", "0 KB"],
				["design_lab", "0 KB"],
			],
		);
	});

	test("the admin's studio page shows the studio's storage", async ({
		client,
		assert,
	}) => {
		const s = await studioWithPhoto("show-admin", 800);
		const admin = await page(
			client,
			`/admin/studios/${slugOf(s.tenant)}`,
			await adminUser(),
		);
		assert.match(
			// biome-ignore lint/suspicious/noExplicitAny: the page's props
			(admin.inertiaProps as any).pilot.storageText,
			new RegExp(
				`^Storage: ${formatBytes(s.bytes).replace(".", "\\.")} of (5|25) GB$`,
			),
		);
	});
});
