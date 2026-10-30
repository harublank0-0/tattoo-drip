import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import ArtistService from "#modules/artists/services/artist_service";
import Client from "#modules/clients/models/client";
import NewInquiryAlertJob from "#modules/inquiries/jobs/new_inquiry_alert_job";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import ImageService from "#modules/media/services/image_service";
import {
	assertApiData,
	assertApiError,
	assertApiHeaders,
} from "#tests/helpers/api";
import { addArtist, addFlashDesign } from "#tests/helpers/artists";
import {
	intakeFields,
	intakeRows,
	png,
	postInquiry,
} from "#tests/helpers/intake";
import { makeClient } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import {
	newTempUploads,
	storedReferenceImages,
	tempUploads,
} from "#tests/helpers/uploads";

const SLUG = "intake-needle-51";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The studio's inquiries and reference images, read in its context. */
const saved = (tenant: { id: string }) =>
	inTenant(tenant, async () => ({
		inquiries: await Inquiry.query().orderBy("created_at"),
		images: await ReferenceImage.query().orderBy("position"),
	}));

test.group("Public API: POST /inquiries", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("takes an inquiry: 201 with only the new id, no-store, no cookie, the alert queued", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const fake = queue.fake();

		const response = await postInquiry(client, SLUG, intakeFields(), [
			await png(),
		]);

		const { id } = response.body().data;
		assert.match(id, UUID);
		assertApiData(response, { id }, 201);
		response.assertHeader("cache-control", "no-store");
		assertApiHeaders(response);
		const { inquiries, images } = await saved(tenant);
		assert.deepEqual(
			inquiries.map((row) => [
				row.id,
				row.status,
				row.contactName,
				row.contactPhone,
			]),
			[[id, "new", "Maya Gurung", "+9779812345678"]],
		);
		assert.deepEqual(
			images.map((row) => [row.inquiryId, row.position]),
			[[id, 0]],
		);
		assert.isTrue(await drive.use("private").exists(images[0].imageKey));
		fake.assertPushed(NewInquiryAlertJob, {
			payload: { tenantId: tenant.id, inquiryId: id },
		});
	});

	test("several image parts are references in their order", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);

		const response = await postInquiry(client, SLUG, intakeFields(), [
			await png("wide.png", 300, 200),
			await png("tall.png", 200, 300),
		]);

		response.assertStatus(201);
		const { images } = await saved(tenant);
		assert.deepEqual(
			images.map((row) => [row.position, row.width, row.height]),
			[
				[0, 300, 200],
				[1, 200, 300],
			],
		);
	});

	test("a phone typed nationally is the returning client's, whose details stay", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const existing = await inTenant(tenant, () =>
			makeClient(tenant, {
				name: "Maya G.",
				phone: "+9779812345678",
				email: null,
				notes: "Prefers mornings",
			}),
		);
		const stored = () =>
			inTenant(tenant, async () =>
				(await Client.findOrFail(existing.id)).serialize(),
			);
		const before = await stored();

		const response = await postInquiry(
			client,
			SLUG,
			intakeFields({
				contactPhone: "981-234-5678",
				contactEmail: "maya@example.com",
			}),
		);

		response.assertStatus(201);
		// The same answer as for a new phone: nothing says the number was known.
		assert.deepEqual(Object.keys(response.body().data), ["id"]);
		const { inquiries } = await saved(tenant);
		assert.equal(inquiries[0].clientId, existing.id);
		assert.equal(inquiries[0].contactEmail, "maya@example.com");
		assert.deepEqual(await stored(), before);
	});

	test("empty optional fields mean none", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner(SLUG);

		const response = await postInquiry(
			client,
			SLUG,
			intakeFields({ preferredArtistId: "", budget: "", contactEmail: "" }),
		);

		response.assertStatus(201);
		const { inquiries, images } = await saved(tenant);
		assert.deepEqual(
			[
				inquiries[0].preferredArtistId,
				inquiries[0].budget,
				inquiries[0].contactEmail,
				images.length,
			],
			[null, null, null, 0],
		);
	});

	test("a JSON body is 415, not a list of field errors", async ({ client }) => {
		await studioWithOwner(SLUG);

		const response = await client
			.post(`/api/v1/tenants/${SLUG}/inquiries`)
			.json(intakeFields());

		assertApiError(response, 415, "unsupported_media_type");
	});

	test("GET is a 405 that allows POST", async ({ client }) => {
		await studioWithOwner(SLUG);

		const response = await client.get(`/api/v1/tenants/${SLUG}/inquiries`);

		assertApiError(response, 405, "method_not_allowed");
		response.assertHeader("allow", "POST");
	});

	test("a success leaves no temp upload, not even a stray file field", async ({
		client,
		assert,
	}) => {
		await studioWithOwner(SLUG);
		const before = await tempUploads();

		const response = await postInquiry(client, SLUG, intakeFields(), [
			await png(),
		]).file("junk", Buffer.from("not an image"), {
			filename: "junk.bin",
			contentType: "application/octet-stream",
		});

		response.assertStatus(201);
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("an unknown studio's 404 leaves no temp upload", async ({
		client,
		assert,
	}) => {
		const before = await tempUploads();

		const response = await postInquiry(
			client,
			"no-such-studio-td51",
			intakeFields(),
			[await png()],
		);

		assertApiError(response, 404, "not_found");
		assert.deepEqual(await newTempUploads(before), []);
	});
});

test.group(
	"Public API: POST /inquiries for a flash design (TAT-129)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
		group.each.teardown(() => queue.restore());

		test("a flash request stores the design and names its artist, even while their books are closed", async ({
			client,
			assert,
		}) => {
			const { tenant, owner } = await studioWithOwner("intake-flash-129a");
			queue.fake();
			const closed = await addArtist(tenant, owner, {
				name: "Closed",
				slug: "closed",
				acceptingInquiries: false,
				acceptingFlash: true,
			});
			const design = await inTenant(tenant, () =>
				addFlashDesign(tenant, closed),
			);

			const response = await postInquiry(
				client,
				"intake-flash-129a",
				intakeFields({ flashDesignId: design.id }),
			);

			response.assertStatus(201);
			const { inquiries } = await saved(tenant);
			assert.lengthOf(inquiries, 1);
			assert.equal(inquiries[0].flashDesignId, design.id);
			assert.equal(inquiries[0].preferredArtistId, closed.id);
			// Naming the same artist is fine too.
			const again = await postInquiry(
				client,
				"intake-flash-129a",
				intakeFields({
					flashDesignId: design.id,
					preferredArtistId: closed.id,
					contactPhone: "9812345679",
				}),
			);
			again.assertStatus(201);
		});

		test("a custom request naming that artist is still artist_not_accepting", async ({
			client,
			assert,
		}) => {
			const { tenant, owner } = await studioWithOwner("intake-flash-129b");
			const closed = await addArtist(tenant, owner, {
				name: "Closed",
				slug: "closed",
				acceptingInquiries: false,
			});
			const before = await intakeRows({ tenant });

			const response = await postInquiry(
				client,
				"intake-flash-129b",
				intakeFields({ preferredArtistId: closed.id }),
			);

			assertApiError(response, 409, "artist_not_accepting");
			assert.deepEqual(await intakeRows({ tenant }), before);
		});

		test("a request for a design whose artist takes no flash requests is artist_not_accepting and stores nothing", async ({
			client,
			assert,
		}) => {
			const { tenant, owner } = await studioWithOwner("intake-flash-129c");
			const off = await addArtist(tenant, owner, {
				name: "Off",
				slug: "off",
				acceptingFlash: false,
			});
			const design = await inTenant(tenant, () => addFlashDesign(tenant, off));
			const before = await intakeRows({ tenant });

			const response = await postInquiry(
				client,
				"intake-flash-129c",
				intakeFields({ flashDesignId: design.id }),
			);

			assertApiError(response, 409, "artist_not_accepting");
			assert.deepEqual(await intakeRows({ tenant }), before);
		});

		test("a hidden design, a hidden or deleted artist's design, an unknown id and another studio's design are flash_unavailable, store nothing and keep no file", async ({
			client,
			assert,
		}) => {
			const { tenant, owner } = await studioWithOwner("intake-flash-129d");
			const other = await studioWithOwner("intake-flash-129e");
			const sita = await addArtist(tenant, owner);
			const hiddenArtist = await addArtist(tenant, owner, {
				name: "Hidden",
				slug: "hidden",
				visible: false,
			});
			const gone = await addArtist(tenant, owner, {
				name: "Gone",
				slug: "gone",
			});
			const theirs = await addArtist(other.tenant, other.owner);
			const designs = await inTenant(tenant, async () => [
				await addFlashDesign(tenant, sita, { hidden: true }),
				await addFlashDesign(tenant, hiddenArtist),
				await addFlashDesign(tenant, gone),
			]);
			const foreign = await inTenant(other.tenant, () =>
				addFlashDesign(other.tenant, theirs),
			);
			await inTenant(tenant, () =>
				new ArtistService(new ImageService()).delete(tenant, gone),
			);
			const before = await intakeRows({ tenant });

			for (const id of [
				...designs.map((design) => design.id),
				foreign.id,
				"0199f000-0000-7000-8000-000000000001",
			]) {
				const response = await postInquiry(
					client,
					"intake-flash-129d",
					intakeFields({ flashDesignId: id }),
					[await png()],
				);
				assertApiError(response, 409, "flash_unavailable");
				assert.equal(
					response.body().error.message,
					"This flash design isn't available any more.",
				);
			}

			assert.deepEqual(await intakeRows({ tenant }), before);
			assert.deepEqual(await storedReferenceImages(tenant), []);
		});

		test("a preferredArtistId other than the design's artist is a field error on preferredArtistId", async ({
			client,
			assert,
		}) => {
			const { tenant, owner } = await studioWithOwner("intake-flash-129f");
			const sita = await addArtist(tenant, owner);
			const mira = await addArtist(tenant, owner, {
				name: "Mira",
				slug: "mira",
			});
			const design = await inTenant(tenant, () => addFlashDesign(tenant, sita));
			const before = await intakeRows({ tenant });

			const response = await postInquiry(
				client,
				"intake-flash-129f",
				intakeFields({ flashDesignId: design.id, preferredArtistId: mira.id }),
			);

			assertApiError(response, 422, "validation_failed");
			assert.deepEqual(Object.keys(response.body().error.fields), [
				"preferredArtistId",
			]);
			assert.deepEqual(await intakeRows({ tenant }), before);
		});

		test("a flashDesignId that isn't a UUID is a field error on flashDesignId", async ({
			client,
			assert,
		}) => {
			const { tenant } = await studioWithOwner("intake-flash-129g");
			const before = await intakeRows({ tenant });

			const response = await postInquiry(
				client,
				"intake-flash-129g",
				intakeFields({ flashDesignId: "the moth" }),
			);

			assertApiError(response, 422, "validation_failed");
			assert.deepEqual(Object.keys(response.body().error.fields), [
				"flashDesignId",
			]);
			assert.deepEqual(response.body().error.fields.flashDesignId, [
				"Choose a design from the studio's page, or none.",
			]);
			assert.deepEqual(await intakeRows({ tenant }), before);
		});
	},
);
