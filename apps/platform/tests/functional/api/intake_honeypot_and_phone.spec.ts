import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import { INTAKE_LIMITS } from "#modules/inquiries/intake_limits";
import BotChallenge from "#services/bot_challenge";
import { API_ERRORS } from "#services/public_api_errors";
import { assertApiError } from "#tests/helpers/api";
import { enableChallenge, siteverify, verdict } from "#tests/helpers/challenge";
import {
	intakeFields,
	intakeRows,
	png,
	postInquiry,
} from "#tests/helpers/intake";
import { makeClient, makeInquiry } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import {
	newTempUploads,
	storedReferenceImages,
	tempUploads,
} from "#tests/helpers/uploads";

const SLUG = "intake-trap-55";
const OTHER = "intake-trap-b-55";
const TOKEN = "good-token-55";

/** A moment for a write stream that is still closing when the response is out. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

/**
 * A studio whose only visible artist is closed: an intake without an artist
 * is a cheap 409 studio_not_accepting, decided after the phone count.
 */
async function closedStudio(slug: string) {
	const { tenant } = await studioWithOwner(slug);
	await inTenant(tenant, () =>
		Artist.create({
			tenantId: tenant.id,
			name: "Sita",
			slug: "sita",
			acceptingInquiries: false,
		}),
	);
	return tenant;
}

test.group("Public API: the intake's honeypot", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => app.container.restore(BotChallenge));

	test("a filled honeypot is 403 challenge_failed after the body: no field named, temp files removed, nothing stored", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		enableChallenge(siteverify(() => verdict(SLUG)));
		const before = await tempUploads();
		const rows = await intakeRows({ tenant });

		const response = await postInquiry(
			client,
			SLUG,
			intakeFields({ website: "https://spam.example" }),
			[await png()],
		).header("x-challenge-token", TOKEN);
		await settle();

		assertApiError(response, 403, "challenge_failed");
		assert.equal(
			response.body().error.message,
			API_ERRORS.challenge_failed.message,
		);
		assert.deepEqual(await newTempUploads(before), []);
		assert.deepEqual(await storedReferenceImages(tenant), []);
		assert.deepEqual(await intakeRows({ tenant }), rows);
	});

	test("an empty or blank honeypot is a person's", async ({ client }) => {
		await studioWithOwner(SLUG);
		enableChallenge(siteverify(() => verdict(SLUG)));

		for (const website of ["", "   "]) {
			(
				await postInquiry(client, SLUG, intakeFields({ website })).header(
					"x-challenge-token",
					TOKEN,
				)
			).assertStatus(201);
		}
	});

	test("a honeypot sent twice is filled when either part is", async ({
		client,
	}) => {
		await studioWithOwner(SLUG);

		const response = await postInquiry(client, SLUG, intakeFields()).field(
			"website",
			["", "https://spam.example"],
		);

		assertApiError(response, 403, "challenge_failed");
	});

	test("with the challenge off the honeypot still refuses, and a challengeToken field is dropped", async ({
		client,
	}) => {
		await studioWithOwner(SLUG);

		assertApiError(
			await postInquiry(client, SLUG, intakeFields({ website: "spam" })),
			403,
			"challenge_failed",
		);
		(
			await postInquiry(
				client,
				SLUG,
				intakeFields({ challengeToken: "t".repeat(3000) }),
			)
		).assertStatus(201);
	});
});

test.group("Public API: the intake's phone limit", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => app.container.restore(BotChallenge));

	test(`the try after ${INTAKE_LIMITS.perPhone.requests} with one phone at one studio in a day is 429, refusals included, however the number is typed`, async ({
		client,
		assert,
	}) => {
		const tenant = await closedStudio(SLUG);
		for (let i = 0; i < INTAKE_LIMITS.perPhone.requests; i++) {
			const contactPhone = i % 2 === 0 ? "9812345678" : "+977 981-234-5678";
			assertApiError(
				await postInquiry(client, SLUG, intakeFields({ contactPhone })),
				409,
				"studio_not_accepting",
			);
		}
		const rows = await intakeRows({ tenant });

		const refused = await postInquiry(client, SLUG, intakeFields(), [
			await png(),
		]);

		assertApiError(refused, 429, "rate_limited");
		assert.isAbove(Number(refused.header("retry-after")), 3600);
		assert.deepEqual(await storedReferenceImages(tenant), []);
		assert.deepEqual(await intakeRows({ tenant }), rows);
		// Another number at the same studio is still heard.
		assertApiError(
			await postInquiry(
				client,
				SLUG,
				intakeFields({ contactPhone: "9812345679" }),
			),
			409,
			"studio_not_accepting",
		);
	});

	test("one phone's count at one studio leaves another studio alone", async ({
		client,
	}) => {
		await closedStudio(SLUG);
		await studioWithOwner(OTHER);
		for (let i = 0; i < INTAKE_LIMITS.perPhone.requests; i++) {
			assertApiError(
				await postInquiry(client, SLUG, intakeFields()),
				409,
				"studio_not_accepting",
			);
		}
		assertApiError(
			await postInquiry(client, SLUG, intakeFields()),
			429,
			"rate_limited",
		);

		(await postInquiry(client, OTHER, intakeFields())).assertStatus(201);
	});

	test("the 3-open cap is unchanged: with the challenge on, a full phone is 409 too_many_open_inquiries", async ({
		client,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		await inTenant(tenant, async () => {
			const maya = await makeClient(tenant, { phone: "+9779812345678" });
			for (let i = 0; i < 3; i++) await makeInquiry(tenant, maya);
		});
		enableChallenge(siteverify(() => verdict(SLUG)));

		assertApiError(
			await postInquiry(client, SLUG, intakeFields()).header(
				"x-challenge-token",
				TOKEN,
			),
			409,
			"too_many_open_inquiries",
		);
	});
});
