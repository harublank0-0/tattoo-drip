import net from "node:net";
import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import type { Assert } from "@japa/assert";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import Client from "#modules/clients/models/client";
import Inquiry from "#modules/inquiries/models/inquiry";
import { ARTIST_MESSAGE } from "#modules/inquiries/validators/intake";
import { IMAGE_FORMAT_MESSAGE } from "#modules/media/errors";
import { API_ERRORS } from "#services/public_api_errors";
import env from "#start/env";
import { assertApiError } from "#tests/helpers/api";
import { testImages } from "#tests/helpers/images";
import {
	intakeFields,
	png,
	postInquiry,
	type Upload,
} from "#tests/helpers/intake";
import { makeClient, makeInquiry } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import {
	newTempUploads,
	storedReferenceImages,
	tempUploads,
} from "#tests/helpers/uploads";

const SLUG = "intake-refuse-51";
const MB = 1024 * 1024;

const file = (name: string, type: string, data: Buffer): Upload => ({
	name,
	type,
	data,
});

/** The studio got nothing: no client, no inquiry, no stored image. */
async function assertNothingSaved(assert: Assert, tenant: { id: string }) {
	const counts = await inTenant(tenant, async () => [
		(await Client.query()).length,
		(await Inquiry.query()).length,
	]);
	assert.deepEqual(counts, [0, 0], "no client or inquiry");
	assert.deepEqual(await storedReferenceImages(tenant), [], "no stored image");
}

test.group("Public API: POST /inquiries refusals", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("missing fields are each named", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner(SLUG);

		const response = await postInquiry(client, SLUG, { note: "only this" });

		assertApiError(response, 422, "validation_failed");
		assert.sameMembers(Object.keys(response.body().error.fields), [
			"idea",
			"placement",
			"approximateSize",
			"preferredDates",
			"sourceChannel",
			"contactName",
			"contactPhone",
		]);
		await assertNothingSaved(assert, tenant);
	});

	test("a 4001-character idea and a NUL are field errors", async ({
		client,
		assert,
	}) => {
		await studioWithOwner(SLUG);

		const response = await postInquiry(
			client,
			SLUG,
			intakeFields({ idea: "x".repeat(4001), placement: "Arm\u0000" }),
		);

		assertApiError(response, 422, "validation_failed");
		assert.deepEqual(response.body().error.fields, {
			idea: ["Use at most 4000 characters."],
			placement: ["Remove the unsupported characters."],
		});
	});

	test("an unknown or hidden artist is a field error on preferredArtistId", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const hidden = await inTenant(tenant, () =>
			Artist.create({
				tenantId: tenant.id,
				name: "Hidden",
				slug: "hidden",
				visible: false,
			}),
		);

		for (const artistId of [
			"0195f3a0-0000-7000-8000-000000000051",
			hidden.id,
		]) {
			const response = await postInquiry(
				client,
				SLUG,
				intakeFields({ preferredArtistId: artistId }),
			);
			assertApiError(response, 422, "validation_failed");
			assert.deepEqual(response.body().error.fields, {
				preferredArtistId: [ARTIST_MESSAGE],
			});
		}
		await assertNothingSaved(assert, tenant);
	});

	test("a closed artist, a closed studio and a full phone are 409s with their codes", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const sita = await inTenant(tenant, () =>
			Artist.create({
				tenantId: tenant.id,
				name: "Sita",
				slug: "sita",
				acceptingInquiries: false,
			}),
		);

		const closedArtist = await postInquiry(
			client,
			SLUG,
			intakeFields({ preferredArtistId: sita.id }),
		);
		const closedStudio = await postInquiry(client, SLUG, intakeFields());
		await inTenant(tenant, () =>
			Artist.create({ tenantId: tenant.id, name: "Bina", slug: "bina" }),
		);
		await inTenant(tenant, async () => {
			const maya = await makeClient(tenant, { phone: "+9779812345678" });
			for (let i = 0; i < 3; i++) await makeInquiry(tenant, maya);
		});
		const fullPhone = await postInquiry(client, SLUG, intakeFields(), [
			await png(),
		]);

		for (const [response, code] of [
			[closedArtist, "artist_not_accepting"],
			[closedStudio, "studio_not_accepting"],
			[fullPhone, "too_many_open_inquiries"],
		] as const) {
			assertApiError(response, 409, code);
			assert.equal(
				response.body().error.message,
				API_ERRORS[code].message,
				code,
			);
		}
		assert.deepEqual(await storedReferenceImages(tenant), []);
	});

	test("six images are too many", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner(SLUG);
		const before = await tempUploads();
		const six: Upload[] = [];
		for (let i = 0; i < 6; i++) six.push(await png(`ref-${i}.png`));

		const response = await postInquiry(client, SLUG, intakeFields(), six);

		assertApiError(response, 422, "validation_failed");
		assert.deepEqual(response.body().error.fields, {
			referenceImages: ["Attach up to 5 images."],
		});
		await assertNothingSaved(assert, tenant);
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("an image over 10 MB is a field error; over 20 MB in all is 413", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const before = await tempUploads();

		const big = await postInquiry(client, SLUG, intakeFields(), [
			file("big.png", "image/png", Buffer.alloc(10 * MB + 1)),
		]);
		const huge = await postInquiry(client, SLUG, intakeFields(), [
			await png(),
			file("huge.png", "image/png", Buffer.alloc(21 * MB)),
		]);

		assertApiError(big, 422, "validation_failed");
		assert.deepEqual(big.body().error.fields, {
			"referenceImages.0": ["Use images of 10 MB or less."],
		});
		assertApiError(huge, 413, "payload_too_large");
		await assertNothingSaved(assert, tenant);
		assert.deepEqual(
			await newTempUploads(before),
			[],
			"the parser's temp files are gone too",
		);
	});

	test("a GIF, a HEIF file and a text file sent as image/png are field errors, and nothing is stored", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const before = await tempUploads();

		const gif = await postInquiry(client, SLUG, intakeFields(), [
			file("moving.gif", "image/gif", await testImages.gif()),
		]);
		const heif = await postInquiry(client, SLUG, intakeFields(), [
			file("photo.heic", "image/heic", await testImages.heif()),
		]);
		const disguised = await postInquiry(client, SLUG, intakeFields(), [
			await png(),
			file("innocent.png", "image/png", Buffer.from("<?php echo 'hi'; ?>")),
		]);

		for (const response of [gif, heif]) {
			assertApiError(response, 422, "validation_failed");
			assert.deepEqual(response.body().error.fields, {
				"referenceImages.0": [IMAGE_FORMAT_MESSAGE],
			});
		}
		assertApiError(disguised, 422, "validation_failed");
		assert.deepEqual(disguised.body().error.fields, {
			"referenceImages.1": [IMAGE_FORMAT_MESSAGE],
		});
		await assertNothingSaved(assert, tenant);
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("a truncated body is bad_request", async ({ client }) => {
		await studioWithOwner(SLUG);

		const response = await client
			.post(`/api/v1/tenants/${SLUG}/inquiries`)
			.unsafeJson(
				'--td51\r\nContent-Disposition: form-data; name="idea"\r\n\r\nA peony',
			)
			.type("multipart/form-data; boundary=td51");

		assertApiError(response, 400, "bad_request");
	});

	test("more than 2 MB of text is 413", async ({ client }) => {
		await studioWithOwner(SLUG);

		const response = await postInquiry(
			client,
			SLUG,
			intakeFields({ idea: "x".repeat(2_200_000) }),
		);

		assertApiError(response, 413, "payload_too_large");
	});
});

const BOUNDARY = "td51";
const FILE_BYTES = "A".repeat(200_000);

/** One file part of a hand-written multipart body (the bytes need not be an image: only the temp file matters here). */
const filePart = (name: string, bytes = FILE_BYTES) =>
	`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n${bytes}\r\n`;

/** POST a hand-written multipart body: what no browser or SDK would send. */
const postRaw = (client: ApiClient, body: string) =>
	client
		.post(`/api/v1/tenants/${SLUG}/inquiries`)
		.unsafeJson(body)
		.type(`multipart/form-data; boundary=${BOUNDARY}`);

/** A moment for a write stream that is still closing when the response is out. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

/** Polls until `check` holds (a cleanup that runs after the client is gone). */
async function until(check: () => Promise<boolean>, what: string) {
	for (let i = 0; i < 100; i++) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 30));
	}
	throw new Error(`Timed out waiting for ${what}`);
}

/** A raw connection to the test server that starts an upload and never finishes it. */
function startUpload(): Promise<net.Socket> {
	return new Promise((resolve, reject) => {
		const socket = net.connect(
			{ host: env.get("HOST"), port: env.get("PORT") },
			() => {
				socket.write(
					[
						`POST /api/v1/tenants/${SLUG}/inquiries HTTP/1.1`,
						`Host: ${env.get("HOST")}`,
						`Content-Type: multipart/form-data; boundary=${BOUNDARY}`,
						"Content-Length: 5000000",
						"Connection: close",
						"",
						filePart("referenceImages").slice(0, -2),
					].join("\r\n"),
				);
				resolve(socket);
			},
		);
		socket.on("error", reject);
	});
}

test.group("Public API: POST /inquiries temp uploads", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a half-sent upload is in the uploads folder while the request is open, and gone when the client hangs up", async ({
		assert,
	}) => {
		await studioWithOwner(SLUG);
		const before = await tempUploads();

		const socket = await startUpload();
		await until(
			async () => (await newTempUploads(before)).length === 1,
			"the half-sent upload to reach tmp/storage/uploads",
		);
		socket.destroy();

		await until(
			async () => (await newTempUploads(before)).length === 0,
			"the half-sent upload to be removed",
		);
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("a file part cut off mid-way is bad_request and leaves no temp file", async ({
		client,
		assert,
	}) => {
		await studioWithOwner(SLUG);
		const before = await tempUploads();

		const response = await postRaw(
			client,
			filePart("referenceImages").slice(0, -2),
		);
		await settle();

		assertApiError(response, 400, "bad_request");
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("a good file part followed by a malformed one leaves no temp file", async ({
		client,
		assert,
	}) => {
		await studioWithOwner(SLUG);
		const before = await tempUploads();

		const response = await postRaw(
			client,
			`${filePart("referenceImages")}--${BOUNDARY}\r\n!!bad header\r\n\r\n--${BOUNDARY}--\r\n`,
		);
		await settle();

		assertApiError(response, 400, "bad_request");
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("a good file part followed by a cut-off one leaves no temp file", async ({
		client,
		assert,
	}) => {
		await studioWithOwner(SLUG);
		const before = await tempUploads();

		const response = await postRaw(
			client,
			`${filePart("referenceImages")}${filePart("referenceImages").slice(0, -2)}`,
		);
		await settle();

		assertApiError(response, 400, "bad_request");
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("file parts named like nested fields leave no temp file, and the inquiry is still taken", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const before = await tempUploads();

		for (const [first, second] of [
			["junk", "junk.extra"],
			["x.__proto__.y", "x.y"],
			["referenceImages", "referenceImages.extra"],
		]) {
			const request = postInquiry(client, SLUG, intakeFields());
			for (const name of [first, second]) {
				request.file(name, Buffer.from(FILE_BYTES), {
					filename: "a.png",
					contentType: "image/png",
				});
			}
			const response = await request;
			await settle();

			assert.oneOf(response.status(), [201, 422], `${first} + ${second}`);
			assert.deepEqual(
				await newTempUploads(before),
				[],
				`${first} + ${second}`,
			);
		}
		assert.isAbove(
			(await inTenant(tenant, () => Inquiry.query())).length,
			0,
			"a stray file field does not stop the inquiry",
		);
	});

	test("a file part named like an Object method cannot crash the parser", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const before = await tempUploads();

		let phone = 9812345600;
		for (const name of [
			"constructor",
			"toString",
			"hasOwnProperty",
			"valueOf",
			"__proto__",
			"__defineGetter__",
			"handler",
			"options",
			"constructor[0]",
		]) {
			// One phone may have 3 open inquiries, so each request has its own.
			const request = postInquiry(
				client,
				SLUG,
				intakeFields({ contactPhone: String(phone++) }),
			);
			request.file(name, Buffer.from(FILE_BYTES), {
				filename: "a.png",
				contentType: "image/png",
			});
			const response = await request;
			await settle();

			assert.equal(response.status(), 201, name);
			assert.deepEqual(await newTempUploads(before), [], name);
		}
		assert.lengthOf(await inTenant(tenant, () => Inquiry.query()), 9);
	});
});
