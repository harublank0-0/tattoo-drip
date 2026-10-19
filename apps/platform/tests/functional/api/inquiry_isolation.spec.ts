import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Client from "#modules/clients/models/client";
import Inquiry from "#modules/inquiries/models/inquiry";
import { ARTIST_MESSAGE } from "#modules/inquiries/validators/intake";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { assertApiError, assertNoCookies } from "#tests/helpers/api";
import {
	intakeFields,
	intakeRows,
	png,
	postInquiry,
} from "#tests/helpers/intake";
import { inTenant, studioWithOwner, twoStudios } from "#tests/helpers/tenants";
import {
	newTempUploads,
	storedReferenceImages,
	tempUploads,
} from "#tests/helpers/uploads";

const ORIGIN = "https://intake-needle-51.tattoodrip.com";

test.group("Public API: POST /inquiries across studios", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("under A, B's artist is a field error and nothing is written in either studio", async ({
		client,
		assert,
	}) => {
		const { a, b } = await twoStudios();
		const [beforeA, beforeB] = [await intakeRows(a), await intakeRows(b)];

		const response = await postInquiry(
			client,
			a.tenant.slug,
			intakeFields({ preferredArtistId: b.artistProfile.id }),
			[await png()],
		);

		assertApiError(response, 422, "validation_failed");
		assert.deepEqual(response.body().error.fields, {
			preferredArtistId: [ARTIST_MESSAGE],
		});
		assert.deepEqual(await intakeRows(a), beforeA);
		assert.deepEqual(await intakeRows(b), beforeB);
		assert.deepEqual(await storedReferenceImages(a.tenant), []);
	});

	test("B's client's phone makes a new client in A and leaves B unchanged", async ({
		client,
		assert,
	}) => {
		const { a, b } = await twoStudios();
		const beforeB = await intakeRows(b);
		const phone = b.client.phone ?? "";

		const response = await postInquiry(
			client,
			a.tenant.slug,
			intakeFields({ contactPhone: phone }),
		);

		response.assertStatus(201);
		const ours = await inTenant(a.tenant, () =>
			Client.query().where("phone", phone),
		);
		assert.lengthOf(ours, 1);
		assert.notEqual(ours[0].id, b.client.id);
		assert.equal(ours[0].tenantId, a.tenant.id);
		assert.deepEqual(await intakeRows(b), beforeB);
	});

	test("a signed-in owner of B posting to A runs as no one, sets no cookie, and the inquiry lands in A", async ({
		client,
		assert,
	}) => {
		const { a, b } = await twoStudios();
		const beforeB = await intakeRows(b);
		const countIn = (studio: typeof a) =>
			inTenant(studio.tenant, async () => (await Inquiry.query()).length);
		const beforeA = await countIn(a);

		const response = await postInquiry(
			client,
			a.tenant.slug,
			intakeFields(),
		).loginAs(b.owner);

		response.assertStatus(201);
		assertNoCookies(response);
		assert.equal(await countIn(a), beforeA + 1);
		assert.deepEqual(await intakeRows(b), beforeB);
	});

	test("an old slug is a 404, even with an invalid body, with nothing written and no temp upload", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("intake-needle-51");
		await inTenant(tenant, () =>
			new TenancyService().changeSlug(tenant, "intake-red-51"),
		);
		const before = await tempUploads();
		const rows = await intakeRows({ tenant });

		const valid = await postInquiry(
			client,
			"intake-needle-51",
			intakeFields(),
			[await png()],
		);
		const invalid = await postInquiry(
			client,
			"intake-needle-51",
			{ idea: "" },
			[await png()],
		);

		for (const response of [valid, invalid]) {
			assertApiError(response, 404, "not_found");
			assert.deepEqual(response.body(), {
				error: { code: "not_found", message: "Not found." },
			});
		}
		assert.deepEqual(await intakeRows({ tenant }), rows);
		assert.deepEqual(await newTempUploads(before), []);
		// The current slug takes it.
		(await postInquiry(client, "intake-red-51", intakeFields())).assertStatus(
			201,
		);
	});

	test("CORS: a multipart POST from another origin is readable, and its preflight passes", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("intake-needle-51");

		const post = await postInquiry(client, tenant.slug, intakeFields()).header(
			"origin",
			ORIGIN,
		);
		const preflight = await client
			.options(`/api/v1/tenants/${tenant.slug}/inquiries`)
			.header("origin", ORIGIN)
			.header("access-control-request-method", "POST")
			.header("access-control-request-headers", "content-type");

		post.assertStatus(201);
		post.assertHeader("access-control-allow-origin", "*");
		assert.isUndefined(post.header("access-control-allow-credentials"));
		preflight.assertStatus(204);
		preflight.assertHeader("access-control-allow-origin", "*");
		preflight.assertHeader("access-control-allow-methods", "GET,HEAD,POST");
		preflight.assertHeader(
			"access-control-allow-headers",
			"accept,content-type",
		);
		assert.isUndefined(preflight.header("access-control-allow-credentials"));
		assertNoCookies(preflight);
	});
});
