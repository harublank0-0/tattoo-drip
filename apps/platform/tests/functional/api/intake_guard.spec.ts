import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { INTAKE_LIMITS } from "#modules/inquiries/intake_limits";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import BotChallenge from "#services/bot_challenge";
import { API_ERRORS } from "#services/public_api_errors";
import { assertApiError } from "#tests/helpers/api";
import {
	enableChallenge,
	siteverify,
	TEST_SECRET,
	verdict,
} from "#tests/helpers/challenge";
import {
	intakeFields,
	intakeRows,
	png,
	postInquiry,
	type Upload,
} from "#tests/helpers/intake";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import {
	newTempUploads,
	storedReferenceImages,
	tempUploads,
} from "#tests/helpers/uploads";

const SLUG = "intake-guard-55";
const OTHER = "intake-guard-b-55";
const IP = "203.0.113.55";
const TOKEN = "good-token-55";

type Send = {
	token?: string;
	ip?: string;
	fields?: Record<string, string>;
	uploads?: Upload[];
};

/** An intake from `ip`, with the token header when `token` is given. */
function send(
	client: ApiClient,
	slug: string,
	{ token, ip = IP, fields = intakeFields(), uploads = [] }: Send = {},
) {
	const request = postInquiry(client, slug, fields, uploads).header(
		"x-forwarded-for",
		ip,
	);
	return token === undefined
		? request
		: request.header("x-challenge-token", token);
}

/** A JSON write with a token: it passes the guard, so it counts, and stops at the controller's 415. */
function jsonTry(client: ApiClient, slug: string, ip: string) {
	return client
		.post(`/api/v1/tenants/${slug}/inquiries`)
		.header("x-forwarded-for", ip)
		.header("x-challenge-token", TOKEN)
		.json({ idea: "A peony" });
}

test.group("Public API: the intake's bot challenge", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => app.container.restore(BotChallenge));

	test("a good token made on the studio's page is taken; Cloudflare saw the secret and the token", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const fake = siteverify(() => verdict(SLUG));
		enableChallenge(fake);

		const response = await send(client, SLUG, {
			token: TOKEN,
			uploads: [await png()],
		});

		response.assertStatus(201);
		assert.lengthOf(fake.calls, 1);
		assert.equal(fake.calls[0].form.get("secret"), TEST_SECRET);
		assert.equal(fake.calls[0].form.get("response"), TOKEN);
		assert.lengthOf((await intakeRows({ tenant })).inquiries, 1);
	});

	test("no token is 403 challenge_failed before the body is read: no Cloudflare call, no temp file, nothing stored", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const fake = siteverify(() => verdict(SLUG));
		enableChallenge(fake);
		const before = await tempUploads();
		const rows = await intakeRows({ tenant });

		const response = await send(client, SLUG, { uploads: [await png()] });

		assertApiError(response, 403, "challenge_failed");
		assert.equal(
			response.body().error.message,
			API_ERRORS.challenge_failed.message,
		);
		assert.lengthOf(fake.calls, 0);
		assert.deepEqual(await newTempUploads(before), []);
		assert.deepEqual(await storedReferenceImages(tenant), []);
		assert.deepEqual(await intakeRows({ tenant }), rows);
	});

	test("a token only in a challengeToken form field doesn't count", async ({
		client,
		assert,
	}) => {
		await studioWithOwner(SLUG);
		const fake = siteverify(() => verdict(SLUG));
		enableChallenge(fake);

		const response = await send(client, SLUG, {
			fields: { ...intakeFields(), challengeToken: TOKEN },
		});

		assertApiError(response, 403, "challenge_failed");
		assert.lengthOf(fake.calls, 0);
	});

	test("every refusal by Cloudflare, another studio's page or another form is the same 403, and nothing is stored", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const rows = await intakeRows({ tenant });
		const answers: Record<string, () => Response> = {
			invalid: () =>
				verdict(SLUG, {
					success: false,
					"error-codes": ["invalid-input-response"],
				}),
			"expired or used twice": () =>
				verdict(SLUG, {
					success: false,
					"error-codes": ["timeout-or-duplicate"],
				}),
			"another studio's page": () => verdict(OTHER),
			"another form": () => verdict(SLUG, { action: "signup" }),
		};

		for (const [why, answer] of Object.entries(answers)) {
			enableChallenge(siteverify(answer));
			const response = await send(client, SLUG, {
				token: TOKEN,
				uploads: [await png()],
			});
			assertApiError(response, 403, "challenge_failed");
			assert.equal(
				response.body().error.message,
				API_ERRORS.challenge_failed.message,
				why,
			);
		}
		assert.deepEqual(await storedReferenceImages(tenant), []);
		assert.deepEqual(await intakeRows({ tenant }), rows);
	});

	test("when Cloudflare can't answer it is 503 challenge_unavailable, and nothing is stored", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const rows = await intakeRows({ tenant });
		const answers: Record<
			string,
			(
				form: URLSearchParams,
				signal: AbortSignal,
			) => Response | Promise<Response>
		> = {
			"a 500": () => new Response("oops", { status: 500 }),
			"not JSON": () => new Response("<html>", { status: 200 }),
			"Cloudflare's own error": () =>
				verdict(SLUG, { success: false, "error-codes": ["internal-error"] }),
			"no answer in time": (_form, signal) =>
				new Promise((_, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), {
						once: true,
					});
				}),
			"a network error": () => Promise.reject(new TypeError("fetch failed")),
		};

		for (const [why, answer] of Object.entries(answers)) {
			enableChallenge(siteverify(answer), { timeoutMs: 50 });
			const response = await send(client, SLUG, { token: TOKEN });
			assertApiError(response, 503, "challenge_unavailable");
			assert.equal(
				response.body().error.message,
				API_ERRORS.challenge_unavailable.message,
				why,
			);
		}
		assert.deepEqual(await intakeRows({ tenant }), rows);
	});

	test("an old or unknown slug is TAT-32's 404 first: no Cloudflare call, nothing counted", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		await inTenant(tenant, () =>
			new TenancyService().changeSlug(tenant, "intake-new-55"),
		);
		const fake = siteverify(() => verdict("intake-new-55"));
		enableChallenge(fake);

		for (let i = 0; i < INTAKE_LIMITS.perAddress.requests; i++) {
			assertApiError(
				await send(client, SLUG, { token: TOKEN }),
				404,
				"not_found",
			);
		}
		assertApiError(
			await send(client, "no-such-studio-td55", { token: TOKEN }),
			404,
			"not_found",
		);

		assert.lengthOf(fake.calls, 0);
		// The address has no count yet: the current slug still takes it.
		(await send(client, "intake-new-55", { token: TOKEN })).assertStatus(201);
	});
});

test.group("Public API: the intake's address and studio limits", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => app.container.restore(BotChallenge));

	test(`the try after ${INTAKE_LIMITS.perAddress.requests} from one address in an hour is 429 with Retry-After, refused tries included, before Cloudflare is asked`, async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const fake = siteverify(() => verdict(SLUG));
		enableChallenge(fake);
		for (let i = 0; i < INTAKE_LIMITS.perAddress.requests; i++) {
			assertApiError(await send(client, SLUG), 403, "challenge_failed");
		}
		const before = await tempUploads();
		const rows = await intakeRows({ tenant });

		const refused = await send(client, SLUG, {
			token: TOKEN,
			uploads: [await png()],
		});

		assertApiError(refused, 429, "rate_limited");
		assert.match(refused.header("retry-after") ?? "", /^\d+$/);
		assert.lengthOf(fake.calls, 0);
		assert.deepEqual(await newTempUploads(before), []);
		assert.deepEqual(await intakeRows({ tenant }), rows);
		// Another address is still heard.
		(
			await send(client, SLUG, { token: TOKEN, ip: "198.51.100.55" })
		).assertStatus(201);
	});

	test("one address's count at one studio leaves another studio alone", async ({
		client,
	}) => {
		await studioWithOwner(SLUG);
		await studioWithOwner(OTHER);
		enableChallenge(siteverify(() => verdict(SLUG)));
		for (let i = 0; i < INTAKE_LIMITS.perAddress.requests; i++) {
			assertApiError(await send(client, SLUG), 403, "challenge_failed");
		}
		assertApiError(
			await send(client, SLUG, { token: TOKEN }),
			429,
			"rate_limited",
		);

		enableChallenge(siteverify(() => verdict(OTHER)));
		(await send(client, OTHER, { token: TOKEN })).assertStatus(201);
	});

	test(`the try after ${INTAKE_LIMITS.perTenant.requests} passed challenges at one studio in an hour is 429; failed ones don't count`, async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		await studioWithOwner(OTHER);
		enableChallenge(siteverify(() => verdict(SLUG)));
		for (let i = 0; i < 5; i++) {
			assertApiError(
				await send(client, SLUG, { ip: `192.0.2.${i}` }),
				403,
				"challenge_failed",
			);
		}
		for (let i = 0; i < INTAKE_LIMITS.perTenant.requests; i++) {
			assertApiError(
				await jsonTry(client, SLUG, `198.51.100.${i}`),
				415,
				"unsupported_media_type",
			);
		}
		const rows = await intakeRows({ tenant });

		const refused = await send(client, SLUG, {
			token: TOKEN,
			ip: "203.0.113.200",
		});

		assertApiError(refused, 429, "rate_limited");
		assert.match(refused.header("retry-after") ?? "", /^\d+$/);
		assert.deepEqual(await intakeRows({ tenant }), rows);
		enableChallenge(siteverify(() => verdict(OTHER)));
		(
			await send(client, OTHER, { token: TOKEN, ip: "203.0.113.200" })
		).assertStatus(201);
	});
});
