import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import { assertApiError } from "#tests/helpers/api";
import {
	depositPath,
	depositReady,
	depositServices,
	OWNER,
} from "#tests/helpers/deposits";
import { testImages } from "#tests/helpers/images";
import { intakeFields, postInquiry } from "#tests/helpers/intake";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { newTempUploads, tempUploads } from "#tests/helpers/uploads";

/**
 * TAT-38 ruling 16. @adonisjs/bodyparser 11.0.4 keeps its multipart handler
 * table in a plain object: a file part named like an Object.prototype
 * property finds a built-in there and throws inside an async listener, an
 * unhandled rejection that ends the process. Nothing may reach that path.
 */
const NAMES = ["constructor", "toString", "__proto__"] as const;
const SLUG = "multipart-38";
const services = depositServices();

const rejections: unknown[] = [];
const record = (reason: unknown) => {
	rejections.push(reason);
};

/** A moment for the parser's async listener (where the crash happens) and closing write streams. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

test.group("Multipart part names from Object.prototype", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => {
		rejections.length = 0;
		process.on("unhandledRejection", record);
		return () => {
			process.off("unhandledRejection", record);
		};
	});

	for (const path of ["/login", "/signup"]) {
		test(`a signed-out multipart body to ${path} is refused unread, and the server goes on`, async ({
			client,
			assert,
		}) => {
			const before = await tempUploads();
			for (const name of NAMES) {
				const response = await client
					.post(path)
					.field("email", "ink@example.com")
					.file(name, Buffer.from("x"), {
						filename: "a.png",
						contentType: "image/png",
					})
					.withCsrfToken()
					.redirects(0)
					.timeout(5000);
				await settle();
				response.assertStatus(415);
			}
			assert.deepEqual(rejections, []);
			assert.deepEqual(await newTempUploads(before), []);
			(await client.get(path)).assertStatus(200);
		});
	}

	test("a signed-in dashboard form with such parts gets its normal answer and leaves no temp file", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG);
		const before = await tempUploads();
		for (const [index, name] of NAMES.entries()) {
			const response = await client
				.post(`/t/${SLUG}/artists`)
				.fields({ name: `Sita ${index}`, slug: `sita-${index}` })
				.file(name, await testImages.png(), { filename: "p.png" })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0)
				.timeout(5000);
			await settle();
			response.assertStatus(302);
		}
		assert.deepEqual(rejections, []);
		assert.deepEqual(await newTempUploads(before), []);
		assert.lengthOf(await inTenant(tenant, () => Artist.query()), 3);
		(await client.get(`/t/${SLUG}/artists`).loginAs(owner)).assertStatus(200);
	});

	test("the public upload routes answer such parts with their normal envelopes", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const ready = await inTenant(tenant, () => depositReady(tenant));
		const { token } = await inTenant(tenant, () =>
			services.links.issue(tenant, OWNER, ready.project),
		);
		const before = await tempUploads();

		let phone = 9812345700;
		for (const name of NAMES) {
			const inquiry = await postInquiry(
				client,
				SLUG,
				intakeFields({ contactPhone: String(phone++) }),
			)
				.file(name, await testImages.png(), { filename: "a.png" })
				.timeout(5000);
			const proof = await client
				.post(depositPath(SLUG, token))
				.fields({ method: "esewa", expectedAmount: "300000" })
				.file(name, await testImages.png(), { filename: "a.png" })
				.timeout(5000);
			await settle();
			inquiry.assertStatus(201);
			// No `proof` part: the screenshot is missing.
			assertApiError(proof, 422, "validation_failed");
		}
		assert.deepEqual(rejections, []);
		assert.deepEqual(await newTempUploads(before), []);
	});
});
