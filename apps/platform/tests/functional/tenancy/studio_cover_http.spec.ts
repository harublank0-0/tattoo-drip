import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import type User from "#models/user";
import Tenant from "#modules/tenancy/models/tenant";
import { polyglot, testImages } from "#tests/helpers/images";
import { failDeletes } from "#tests/helpers/storage_failures";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import {
	newTempUploads,
	storedImages,
	tempUploads,
} from "#tests/helpers/uploads";
import { assertValidationError } from "#tests/helpers/validation";

const PURPOSE = "studio_cover";
const FORMAT = "Upload a JPEG, PNG or WebP image.";
const reload = (tenant: { id: string }) =>
	inTenant(tenant, () => Tenant.findOrFail(tenant.id));

const setCover = (
	client: ApiClient,
	user: User,
	tenant: { slug: string },
	data: Buffer,
	filename = "cover.jpg",
) =>
	client
		.put(`/t/${tenant.slug}/settings/cover`)
		.file("cover", data, { filename })
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);

const removeCover = (client: ApiClient, user: User, tenant: { slug: string }) =>
	client
		.delete(`/t/${tenant.slug}/settings/cover`)
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);

test.group("Studio cover photo (TAT-116)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sets, replaces and removes the cover", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		const set = await setCover(
			client,
			owner,
			tenant,
			await testImages.jpeg(2048, 1536),
		);
		set.assertStatus(302);
		set.assertHeader("location", `/t/${tenant.slug}/settings/profile`);
		set.assertFlashMessage("success", "Cover photo saved.");
		const first = await reload(tenant);
		assert.match(
			first.coverImageKey ?? "",
			new RegExp(`^tenants/${tenant.id}/${PURPOSE}/`),
		);
		assert.equal(first.coverImageWidth, 2048);
		assert.equal(first.coverImageHeight, 1536);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 4);

		const replaced = await setCover(
			client,
			owner,
			tenant,
			await testImages.png(1800, 1200),
			"cover.png",
		);
		replaced.assertStatus(302);
		const second = await reload(tenant);
		assert.notEqual(second.coverImageKey, first.coverImageKey);
		assert.lengthOf(
			await storedImages(tenant, PURPOSE),
			4,
			"one cover is left",
		);

		const removed = await removeCover(client, owner, tenant);
		removed.assertStatus(302);
		removed.assertHeader("location", `/t/${tenant.slug}/settings/profile`);
		removed.assertFlashMessage("success", "Cover photo removed.");
		const after = await reload(tenant);
		assert.isNull(after.coverImageKey);
		assert.isNull(after.coverImageWidth);
		assert.isNull(after.coverImageHeight);
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
	});

	test("an artist member gets a 404 for both routes and nothing changes", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const member = await artistIn(tenant);
		await setCover(client, owner, tenant, await testImages.jpeg(2048, 1536));
		const before = await reload(tenant);
		const temp = await tempUploads();

		const set = await setCover(
			client,
			member,
			tenant,
			await testImages.jpeg(2048, 1536),
		);
		const removed = await removeCover(client, member, tenant);

		set.assertStatus(404);
		removed.assertStatus(404);
		assert.equal((await reload(tenant)).coverImageKey, before.coverImageKey);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 4);
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.deepEqual(await newTempUploads(temp), []);
	});

	test("an unusable file is a field error on cover and changes nothing", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
		const cases: [string, Buffer, string, string][] = [
			["svg", svg, "cover.svg", FORMAT],
			["svg as .jpg", svg, "cover.jpg", FORMAT],
			["heic", await testImages.heif(), "cover.heic", FORMAT],
			["gif as .png", await testImages.gif(), "cover.png", FORMAT],
			[
				"49 MP png",
				await testImages.huge(),
				"cover.png",
				"This image is too large. Use one under 40 megapixels.",
			],
		];
		const temp = await tempUploads();

		for (const [name, data, filename, message] of cases) {
			const response = await setCover(client, owner, tenant, data, filename);
			assertValidationError(response, "cover", message);
			assert.isNull((await reload(tenant)).coverImageKey, name);
			assert.deepEqual(await storedImages(tenant, PURPOSE), [], name);
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.deepEqual(await newTempUploads(temp), []);
	});

	test("a failed replace keeps the old cover", async ({ client, assert }) => {
		const { tenant, owner } = await studioWithOwner();
		await setCover(client, owner, tenant, await testImages.jpeg(2048, 1536));
		const before = (await reload(tenant)).coverImageKey;

		const response = await setCover(
			client,
			owner,
			tenant,
			await testImages.gif(),
			"cover.png",
		);

		assertValidationError(response, "cover", FORMAT);
		assert.equal((await reload(tenant)).coverImageKey, before);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 4);
	});

	test("without a file, or over 10 MB, the cover field says so", async ({
		client,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		const none = await client
			.put(`/t/${tenant.slug}/settings/cover`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		const big = await setCover(
			client,
			owner,
			tenant,
			Buffer.alloc(11 * 1024 * 1024),
			"big.jpg",
		);

		assertValidationError(none, "cover", "Choose a photo to upload.");
		assertValidationError(big, "cover", "Use an image of 10 MB or less.");
	});

	test("a polyglot cover is processed like any image (its bytes are checked in image_service.spec.ts)", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		const response = await setCover(client, owner, tenant, await polyglot());

		response.assertStatus(302);
		assert.isNotNull((await reload(tenant)).coverImageKey);
	});

	test("removing when there is no cover is still a redirect with a note", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		const response = await removeCover(client, owner, tenant);

		response.assertStatus(302);
		assert.isNull((await reload(tenant)).coverImageKey);
	});
});

test.group(
	"A cover removal that can't delete the files fails visibly (TAT-116 fix round 1)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("the cover stays with an error message, and removing again once storage is back succeeds", async ({
			client,
			assert,
		}) => {
			const { tenant, owner } = await studioWithOwner();
			await setCover(client, owner, tenant, await testImages.jpeg(2048, 1536));
			const key = (await reload(tenant)).coverImageKey;
			const failing = failDeletes("public", () => true);

			let refused: Awaited<ReturnType<typeof removeCover>>;
			try {
				refused = await removeCover(client, owner, tenant);
			} finally {
				failing.restore();
			}

			refused.assertStatus(302);
			refused.assertHeader("location", `/t/${tenant.slug}/settings/profile`);
			refused.assertFlashMessage(
				"error",
				"Couldn't remove the cover photo, try again.",
			);
			assert.equal((await reload(tenant)).coverImageKey, key);
			assert.lengthOf(await storedImages(tenant, PURPOSE), 4);

			const retry = await removeCover(client, owner, tenant);
			retry.assertFlashMessage("success", "Cover photo removed.");
			assert.isNull((await reload(tenant)).coverImageKey);
			assert.deepEqual(await storedImages(tenant, PURPOSE), []);
		});
	},
);
