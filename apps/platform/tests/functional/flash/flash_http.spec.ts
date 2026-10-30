import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import ArtistService from "#modules/artists/services/artist_service";
import FlashDesign from "#modules/flash/models/flash_design";
import FlashService from "#modules/flash/services/flash_service";
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { addArtist, addFlashDesign } from "#tests/helpers/artists";
import { testImages, uploadOf } from "#tests/helpers/images";
import { makeClient, makeInquiry } from "#tests/helpers/pipeline";
import { failDeletes } from "#tests/helpers/storage_failures";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { storedImages } from "#tests/helpers/uploads";
import { assertValidationError } from "#tests/helpers/validation";

const PURPOSE = "flash_design";
const PRICE_MESSAGE =
	"Enter whole rupees from 1 to 1,00,00,000, or leave it empty.";
const NAME_MESSAGE = "Give the design a name, up to 80 characters on one line.";
const SIZE_MESSAGE =
	"Say how big it is, like About 3 in: up to 60 characters on one line.";
const LIMIT_MESSAGE =
	"This artist already has 100 flash designs. Remove one to add another.";

const images = new ImageService();
const artistService = new ArtistService(images);
const flashService = new FlashService(images, artistService);

/** The artist's rows, newest first. */
const rows = (tenant: Tenant, artistId: string) =>
	inTenant(tenant, () =>
		FlashDesign.query()
			.where("artist_id", artistId)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc"),
	);

type Fields = { name?: string; size?: string; price?: string };

/** POST a picture and the fields as the artist page's add form sends them. */
const add = (
	client: ApiClient,
	user: User,
	tenant: Tenant,
	artistId: string,
	fields: Fields = { name: "Moth", size: "About 3 in", price: "3000" },
	picture: { data: Buffer; filename: string } | null = null,
	withoutPicture = false,
) => {
	const request = client
		.post(`/t/${tenant.slug}/artists/${artistId}/flash`)
		.fields({ ...fields })
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);
	if (withoutPicture) return request;
	return request.file("picture", picture?.data ?? PNG, {
		filename: picture?.filename ?? "design.png",
	});
};

let PNG: Buffer;

/** A design added through the service, with its real files. */
async function realDesign(
	tenant: Tenant,
	owner: User,
	artistId: string,
	name = "Moth",
) {
	const artist = await inTenant(tenant, () =>
		artistService.findFor(tenant, artistId),
	);
	return inTenant(tenant, async () =>
		flashService.add(
			tenant,
			{ userId: owner.id, role: "owner" },
			artist,
			await uploadOf(await testImages.png(1200, 1200)),
			{ name, size: "About 3 in", price: null },
		),
	);
}

const save = (
	client: ApiClient,
	user: User,
	tenant: Tenant,
	id: string,
	fields: Fields & { shown?: string },
) =>
	client
		.put(`/t/${tenant.slug}/artists/flash/${id}`)
		.fields({ name: "Moth", size: "About 3 in", ...fields })
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);

const remove = (client: ApiClient, user: User, tenant: Tenant, id: string) =>
	client
		.delete(`/t/${tenant.slug}/artists/flash/${id}`)
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);

test.group("Flash designs over HTTP (TAT-129)", (group) => {
	group.setup(async () => {
		PNG = await testImages.png(1200, 1200);
	});
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner adds a design with a picture, name, size and price", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);

		const response = await add(client, owner, tenant, sita.id);

		response.assertStatus(302);
		response.assertHeader(
			"location",
			`/t/${tenant.slug}/artists/${sita.id}/edit`,
		);
		response.assertFlashMessage("success", "Design added.");
		const [design] = await rows(tenant, sita.id);
		assert.equal(design.name, "Moth");
		assert.equal(design.size, "About 3 in");
		assert.equal(design.price, 300000);
		assert.isFalse(design.hidden);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 3);
	});

	test("the price may be left empty", async ({ client, assert }) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);

		const response = await add(client, owner, tenant, sita.id, {
			name: "Moth",
			size: "About 3 in",
			price: "",
		});

		response.assertStatus(302);
		assert.isNull((await rows(tenant, sita.id))[0].price);
	});

	test("a bad price is a field error and nothing is stored", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);

		for (const price of ["0", "12.5", "10000001", "abc"]) {
			const response = await add(client, owner, tenant, sita.id, {
				name: "Moth",
				size: "About 3 in",
				price,
			});
			assertValidationError(response, "price", PRICE_MESSAGE);
		}

		assert.lengthOf(await rows(tenant, sita.id), 0);
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
	});

	test("a missing picture, name or size is a field error with its words", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const ok = { name: "Moth", size: "About 3 in" };

		assertValidationError(
			await add(client, owner, tenant, sita.id, ok, null, true),
			"picture",
			"Choose a picture of the design.",
		);
		assertValidationError(
			await add(client, owner, tenant, sita.id, { size: ok.size }),
			"name",
			NAME_MESSAGE,
		);
		assertValidationError(
			await add(client, owner, tenant, sita.id, { name: ok.name }),
			"size",
			SIZE_MESSAGE,
		);
		assertValidationError(
			await add(client, owner, tenant, sita.id, {
				name: "x".repeat(81),
				size: ok.size,
			}),
			"name",
			NAME_MESSAGE,
		);
		assertValidationError(
			await add(client, owner, tenant, sita.id, {
				name: "Mo\nth",
				size: ok.size,
			}),
			"name",
			NAME_MESSAGE,
		);
		assertValidationError(
			await add(client, owner, tenant, sita.id, {
				name: "   ",
				size: ok.size,
			}),
			"name",
			NAME_MESSAGE,
		);
		assertValidationError(
			await add(client, owner, tenant, sita.id, {
				name: ok.name,
				size: "x".repeat(61),
			}),
			"size",
			SIZE_MESSAGE,
		);
		assertValidationError(
			await add(client, owner, tenant, sita.id, {
				name: ok.name,
				size: "About\n3 in",
			}),
			"size",
			SIZE_MESSAGE,
		);

		assert.lengthOf(await rows(tenant, sita.id), 0);
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
	});

	test("a file that isn't an image is a field error on picture", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);

		const response = await add(
			client,
			owner,
			tenant,
			sita.id,
			{ name: "Moth", size: "About 3 in" },
			{ data: Buffer.from("not an image at all"), filename: "broken.png" },
		);

		assertValidationError(response, "picture");
		assert.lengthOf(await rows(tenant, sita.id), 0);
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
	});

	test("the 101st design is a field error on picture and stores nothing", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		await inTenant(tenant, async () => {
			for (let n = 0; n < 100; n++) await addFlashDesign(tenant, sita);
		});

		const response = await add(client, owner, tenant, sita.id);

		assertValidationError(response, "picture", LIMIT_MESSAGE);
		assert.lengthOf(await rows(tenant, sita.id), 100);
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
	});

	test("an artist adds and edits their own designs; another artist's design or artist is a 404 with any body", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const member = await artistIn(tenant);
		const own = await addArtist(tenant, member, {
			name: "Own",
			slug: "own",
			linkToMe: true,
		});
		const other = await addArtist(tenant, owner, {
			name: "Mira",
			slug: "mira",
		});
		const theirs = await inTenant(tenant, () => addFlashDesign(tenant, other));

		const added = await add(client, member, tenant, own.id);
		added.assertStatus(302);
		const [mine] = await rows(tenant, own.id);
		const saved = await save(client, member, tenant, mine.id, {
			name: "Own moth",
		});
		saved.assertStatus(302);
		saved.assertFlashMessage("success", "Design saved.");

		(await add(client, member, tenant, other.id)).assertStatus(404);
		(await save(client, member, tenant, theirs.id, {})).assertStatus(404);
		// A 404 whatever the body.
		(
			await client
				.put(`/t/${tenant.slug}/artists/flash/${theirs.id}`)
				.fields({ name: "", size: "" })
				.withCsrfToken()
				.loginAs(member)
				.redirects(0)
		).assertStatus(404);
		(await remove(client, member, tenant, theirs.id)).assertStatus(404);
		assert.equal((await rows(tenant, own.id))[0].name, "Own moth");
		assert.lengthOf(await rows(tenant, other.id), 1);
	});

	test("a save with shown unchecked hides the design; checked shows it again", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const design = await inTenant(tenant, () => addFlashDesign(tenant, sita));

		const hidden = await save(client, owner, tenant, design.id, {
			price: "",
		});
		hidden.assertStatus(302);
		hidden.assertHeader(
			"location",
			`/t/${tenant.slug}/artists/${sita.id}/edit`,
		);
		hidden.assertFlashMessage("success", "Design saved.");
		assert.isTrue((await rows(tenant, sita.id))[0].hidden);

		await save(client, owner, tenant, design.id, { shown: "1" });
		assert.isFalse((await rows(tenant, sita.id))[0].hidden);
	});

	test("a design's save keeps the picture and reports a bad field with its words", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const design = await inTenant(tenant, () =>
			addFlashDesign(tenant, sita, { name: "Moth", price: 100_000 }),
		);

		assertValidationError(
			await save(client, owner, tenant, design.id, { name: "", shown: "1" }),
			"name",
			NAME_MESSAGE,
		);
		assertValidationError(
			await save(client, owner, tenant, design.id, {
				price: "0",
				shown: "1",
			}),
			"price",
			PRICE_MESSAGE,
		);
		const saved = await save(client, owner, tenant, design.id, {
			name: "  Moth, smaller ",
			size: "About 2 in",
			price: "1500",
			shown: "1",
		});
		saved.assertStatus(302);

		const [read] = await rows(tenant, sita.id);
		assert.equal(read.name, "Moth, smaller");
		assert.equal(read.size, "About 2 in");
		assert.equal(read.price, 150_000);
		assert.equal(read.imageKey, design.imageKey);
	});

	test("remove: 'Design removed.' and the row is gone; a design a request names stays, with the error flash", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const gone = await realDesign(tenant, owner, sita.id, "Gone");
		const named = await realDesign(tenant, owner, sita.id, "Named");
		await inTenant(tenant, async () => {
			const person = await makeClient(tenant);
			await makeInquiry(tenant, person, { flashDesignId: named.id });
		});
		assert.lengthOf(await storedImages(tenant, PURPOSE), 6);

		const removed = await remove(client, owner, tenant, gone.id);
		removed.assertStatus(302);
		removed.assertHeader(
			"location",
			`/t/${tenant.slug}/artists/${sita.id}/edit`,
		);
		removed.assertFlashMessage("success", "Design removed.");
		assert.deepEqual(
			(await rows(tenant, sita.id)).map((row) => row.id),
			[named.id],
		);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 3);

		const refused = await remove(client, owner, tenant, named.id);
		refused.assertStatus(302);
		refused.assertFlashMessage(
			"error",
			"Clients asked for this design, so it can't be removed. Hide it instead.",
		);
		assert.lengthOf(await rows(tenant, sita.id), 1);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 3);
	});

	test("remove: when a file can't be deleted the design is hidden and the owner is told, and a retry removes it", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const design = await realDesign(tenant, owner, sita.id);

		const failing = failDeletes("public", (key) => key.includes("640w"));
		let refused: Awaited<ReturnType<typeof remove>>;
		try {
			refused = await remove(client, owner, tenant, design.id);
		} finally {
			failing.restore();
		}
		refused.assertStatus(302);
		refused.assertFlashMessage(
			"error",
			"Some of this design's files couldn't be removed. It's hidden now; try Remove again.",
		);
		const [row] = await rows(tenant, sita.id);
		assert.deepEqual([row.id, row.hidden], [design.id, true]);

		const retried = await remove(client, owner, tenant, design.id);
		retried.assertFlashMessage("success", "Design removed.");
		assert.lengthOf(await rows(tenant, sita.id), 0);
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
	});

	test("another studio's design id is a 404 for every route", async ({
		client,
		assert,
	}) => {
		const a = await studioWithOwner("flash-http-a", "Flash A");
		const b = await studioWithOwner("flash-http-b", "Flash B");
		const artistB = await addArtist(b.tenant, b.owner);
		const designB = await inTenant(b.tenant, () =>
			addFlashDesign(b.tenant, artistB),
		);

		(await save(client, a.owner, a.tenant, designB.id, {})).assertStatus(404);
		(await remove(client, a.owner, a.tenant, designB.id)).assertStatus(404);
		(await add(client, a.owner, a.tenant, artistB.id)).assertStatus(404);
		assert.lengthOf(await rows(b.tenant, artistB.id), 1);
	});

	test("the edit page lists the artist's designs newest first, hidden ones too, each with exactly id, name, size, price, priceText, hidden and thumbnailUrl", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const sita = await addArtist(tenant, owner);
		const now = DateTime.now();
		const [middle, oldest, newest] = await inTenant(tenant, async () => [
			await addFlashDesign(tenant, sita, {
				name: "middle",
				price: 300_000,
				createdAt: now.minus({ days: 2 }),
			}),
			await addFlashDesign(tenant, sita, {
				name: "oldest",
				createdAt: now.minus({ days: 3 }),
			}),
			await addFlashDesign(tenant, sita, {
				name: "newest",
				hidden: true,
				createdAt: now.minus({ days: 1 }),
			}),
		]);

		const response = await client
			.get(`/t/${tenant.slug}/artists/${sita.id}/edit`)
			.withInertia()
			.loginAs(owner);

		const { flashDesigns } = response.inertiaProps;
		assert.deepEqual(
			flashDesigns.map((design: { id: string }) => design.id),
			[newest.id, middle.id, oldest.id],
		);
		for (const design of flashDesigns) {
			assert.deepEqual(Object.keys(design).sort(), [
				"hidden",
				"id",
				"name",
				"price",
				"priceText",
				"size",
				"thumbnailUrl",
			]);
		}
		assert.equal(flashDesigns[1].price, 3000);
		assert.equal(flashDesigns[1].priceText, "NPR 3,000");
		assert.isNull(flashDesigns[2].price);
		assert.isNull(flashDesigns[2].priceText);
		assert.isTrue(flashDesigns[0].hidden);
		assert.match(flashDesigns[0].thumbnailUrl, /\.320w\.png$/);
		assert.isTrue(response.inertiaProps.artist.acceptingFlash);

		const created = await client
			.get(`/t/${tenant.slug}/artists/new`)
			.withInertia()
			.loginAs(owner);
		assert.deepEqual(created.inertiaProps.flashDesigns, []);
	});
});
