import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import Client from "#modules/clients/models/client";
import NewInquiryAlertJob from "#modules/inquiries/jobs/new_inquiry_alert_job";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import {
	assertApiData,
	assertApiError,
	assertApiHeaders,
} from "#tests/helpers/api";
import { intakeFields, png, postInquiry } from "#tests/helpers/intake";
import { makeClient } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { newTempUploads, tempUploads } from "#tests/helpers/uploads";

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
