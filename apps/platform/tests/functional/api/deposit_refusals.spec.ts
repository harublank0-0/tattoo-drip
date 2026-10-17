import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { DEPOSIT_LIMITS } from "#modules/payments/deposit_limits";
import { newTokenNonce, tokenFor } from "#modules/payments/deposit_links";
import Payment from "#modules/payments/models/payment";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { assertApiError, assertApiHeaders } from "#tests/helpers/api";
import {
	depositPath,
	depositReady,
	depositServices,
	OWNER,
	postProof,
	proofPart,
	storedProofs,
} from "#tests/helpers/deposits";
import { makePayment } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { newTempUploads, tempUploads } from "#tests/helpers/uploads";

const SLUG = "deposit-refuse-65";
const PROOF = { method: "esewa", expectedAmount: "300000" };
const services = depositServices();

/** A studio with a deposit due and its link. */
async function deposit(slug = SLUG) {
	const { owner, tenant } = await studioWithOwner(slug, "Black Needle");
	const ready = await inTenant(tenant, () => depositReady(tenant));
	const issued = await inTenant(tenant, () =>
		services.links.issue(tenant, OWNER, ready.project),
	);
	return { owner, tenant, ...ready, ...issued };
}

const paymentCount = async (tenant: { id: string }) =>
	(await inTenant(tenant, () => Payment.query())).length;

test.group("Public API: deposit refusals", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a state that takes no screenshot is 409 deposit_not_due, with no row, file or temp upload", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG, "Black Needle");
		const tokens = await inTenant(tenant, async () => {
			const made = async () => {
				const ready = await depositReady(tenant);
				const { token } = await services.links.issue(
					tenant,
					OWNER,
					ready.project,
				);
				return { ...ready, token };
			};
			const waiting = await made();
			await makePayment(tenant, waiting.project, { method: "esewa" });
			const paid = await made();
			await makePayment(tenant, paid.project, {
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
			const cancelled = await made();
			cancelled.project.status = "cancelled";
			await cancelled.project.save();
			const revising = await made();
			revising.project.status = "quoted";
			await revising.project.save();
			const expired = await made();
			expired.quote.expiresAt = DateTime.utc().minus({ minutes: 1 });
			await expired.quote.save();
			return [waiting, paid, cancelled, revising, expired].map(
				({ token }) => token,
			);
		});
		const rows = await paymentCount(tenant);
		const before = await tempUploads();

		for (const token of tokens) {
			assertApiError(
				await postProof(client, SLUG, token, PROOF, [await proofPart()]),
				409,
				"deposit_not_due",
			);
		}

		assert.equal(await paymentCount(tenant), rows);
		assert.lengthOf(await storedProofs(tenant), 0);
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("a stale amount is 409 deposit_changed", async ({ client, assert }) => {
		const { tenant, token } = await deposit();

		assertApiError(
			await postProof(
				client,
				SLUG,
				token,
				{ ...PROOF, expectedAmount: "250000" },
				[await proofPart()],
			),
			409,
			"deposit_changed",
		);
		assert.equal(await paymentCount(tenant), 0);
	});

	test("a second screenshot while one waits is 409, and one payment and one file stay", async ({
		client,
		assert,
	}) => {
		const { tenant, token } = await deposit();

		(
			await postProof(client, SLUG, token, PROOF, [await proofPart()])
		).assertStatus(201);
		assertApiError(
			await postProof(client, SLUG, token, PROOF, [await proofPart()]),
			409,
			"deposit_not_due",
		);

		assert.equal(await paymentCount(tenant), 1);
		assert.lengthOf(await storedProofs(tenant), 1);
		const page = (await client.get(depositPath(SLUG, token))).body().data;
		assert.equal(page.state, "submitted");
	});

	test("over 20 MB in all is 413 and leaves no temp upload", async ({
		client,
		assert,
	}) => {
		const { tenant, token } = await deposit();
		const before = await tempUploads();

		const response = await postProof(client, SLUG, token, PROOF, [
			{
				field: "proof",
				name: "huge.png",
				type: "image/png",
				data: Buffer.alloc(21 * 1024 * 1024),
			},
		]);

		assertApiError(response, 413, "payload_too_large");
		assert.deepEqual(await newTempUploads(before), []);
		assert.equal(await paymentCount(tenant), 0);
	});
});

test.group("Public API: deposit rate limits", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test(`the read after ${DEPOSIT_LIMITS.read.perToken.requests} of one link in 10 minutes is 429 with Retry-After; uploads count apart`, async ({
		client,
		assert,
	}) => {
		const { token } = await deposit();
		const path = depositPath(SLUG, token);

		for (let i = 0; i < DEPOSIT_LIMITS.read.perToken.requests; i++) {
			(await client.get(path)).assertStatus(200);
		}
		const refused = await client.get(path);

		assertApiError(refused, 429, "rate_limited");
		assert.match(refused.header("retry-after") ?? "", /^\d+$/);
		// Reads used up; the upload has its own count.
		(
			await postProof(client, SLUG, token, PROOF, [await proofPart()])
		).assertStatus(201);
	});

	test(`the read after ${DEPOSIT_LIMITS.read.perAddress.requests} from one address is 429, across links and unknown tokens`, async ({
		client,
	}) => {
		const { token } = await deposit();

		for (let i = 0; i < DEPOSIT_LIMITS.read.perAddress.requests; i++) {
			assertApiError(
				await client.get(depositPath(SLUG, tokenFor(newTokenNonce()))),
				404,
				"not_found",
			);
		}

		assertApiError(
			await client.get(depositPath(SLUG, token)),
			429,
			"rate_limited",
		);
	});

	test(`the upload after ${DEPOSIT_LIMITS.submit.perToken.requests} for one link in an hour is 429, and leaves no temp upload`, async ({
		client,
		assert,
	}) => {
		const { tenant, token } = await deposit();
		for (let i = 0; i < DEPOSIT_LIMITS.submit.perToken.requests; i++) {
			assertApiError(
				await client.post(depositPath(SLUG, token)).json(PROOF),
				415,
				"unsupported_media_type",
			);
		}
		const before = await tempUploads();

		const refused = await postProof(client, SLUG, token, PROOF, [
			await proofPart(),
		]);

		assertApiError(refused, 429, "rate_limited");
		assert.deepEqual(await newTempUploads(before), []);
		assert.equal(await paymentCount(tenant), 0);
	});
});

test.group("Public API: deposits across slugs and studios", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("under an old slug the page answers, and an upload is the 404 with no temp upload", async ({
		client,
		assert,
	}) => {
		const { tenant, token } = await deposit();
		await inTenant(tenant, () =>
			new TenancyService().changeSlug(tenant, "deposit-renamed-65"),
		);
		const before = await tempUploads();

		(await client.get(depositPath(SLUG, token))).assertStatus(200);
		assertApiError(
			await postProof(client, SLUG, token, PROOF, [await proofPart()]),
			404,
			"not_found",
		);
		assert.deepEqual(await newTempUploads(before), []);
		(
			await postProof(client, "deposit-renamed-65", token, PROOF, [
				await proofPart(),
			])
		).assertStatus(201);
	});

	test("a link works only under its own studio's slug", async ({ client }) => {
		const mine = await deposit("deposit-mine-65");
		const theirs = await deposit("deposit-theirs-65");

		assertApiError(
			await client.get(depositPath("deposit-mine-65", theirs.token)),
			404,
			"not_found",
		);
		assertApiError(
			await client.get(depositPath("deposit-theirs-65", mine.token)),
			404,
			"not_found",
		);
		assertApiError(
			await postProof(client, "deposit-mine-65", theirs.token, PROOF, [
				await proofPart(),
			]),
			404,
			"not_found",
		);
	});

	test("a browser on another origin gets the page and can upload, without credentials", async ({
		client,
	}) => {
		const { token } = await deposit();
		const origin = "http://deposit-refuse-65.localhost:3000";

		const read = await client
			.get(depositPath(SLUG, token))
			.header("origin", origin);
		read.assertStatus(200);
		assertApiHeaders(read);
		const upload = await postProof(client, SLUG, token, PROOF, [
			await proofPart(),
		]).header("origin", origin);
		upload.assertStatus(201);
		assertApiHeaders(upload);
	});

	test("the link an owner copies from the project page opens its deposit page", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
		const { project } = await inTenant(tenant, () => depositReady(tenant));

		await client
			.post(`/t/${SLUG}/projects/${project.id}/deposit-link`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		const panel = (
			await client
				.get(`/t/${SLUG}/projects/${project.id}`)
				.withInertia()
				.loginAs(owner)
		).inertiaProps.deposit;
		const token = new URL(panel.link.url).hash.slice(1);
		const page = await client.get(depositPath(SLUG, token));

		page.assertStatus(200);
		assert.equal(page.body().data.referenceCode, panel.link.referenceCode);
	});
});
