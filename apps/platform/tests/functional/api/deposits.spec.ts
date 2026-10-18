import testUtils from "@adonisjs/core/services/test_utils";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { IMAGE_FORMAT_MESSAGE } from "#modules/media/errors";
import { newTokenNonce, tokenFor } from "#modules/payments/deposit_links";
import DepositProofAlertJob from "#modules/payments/jobs/deposit_proof_alert_job";
import Payment from "#modules/payments/models/payment";
import {
	AMOUNT_MESSAGE,
	METHOD_MESSAGE,
	PROOF_MESSAGE,
} from "#modules/payments/validators/deposit_proof";
import { formatDay, validUntil } from "#modules/projects/quotes";
import {
	assertApiData,
	assertApiError,
	assertApiHeaders,
} from "#tests/helpers/api";
import {
	depositPath,
	depositReady,
	depositServices,
	OWNER,
	postProof,
	proofPart,
	storedProofs,
} from "#tests/helpers/deposits";
import { testImages } from "#tests/helpers/images";
import { makeArtist } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { newTempUploads, tempUploads } from "#tests/helpers/uploads";

const SLUG = "deposit-api-65";
const KTM = "Asia/Kathmandu";
const services = depositServices();
const PROOF = { method: "esewa", expectedAmount: "300000" };

/** A studio with a policy, an assigned artist, a deposit due and its link. */
async function deposit(slug = SLUG) {
	const { tenant } = await studioWithOwner(slug, "Black Needle");
	const ready = await inTenant(tenant, async () => {
		tenant.merge({ depositPolicy: "Deposits hold your date." });
		await tenant.save();
		const ready = await depositReady(tenant);
		const artist = await makeArtist(tenant, "sita");
		ready.project.artistId = artist.id;
		await ready.project.save();
		return ready;
	});
	const issued = await inTenant(tenant, () =>
		services.links.issue(tenant, OWNER, ready.project),
	);
	return { tenant, ...ready, ...issued };
}

const paymentsOf = (tenant: { id: string }, projectId: string) =>
	inTenant(tenant, () => Payment.query().where("project_id", projectId));

test.group("Public API: GET /deposits/:token", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("answers exactly the contract's DepositPage, no-store, no cookie", async ({
		client,
	}) => {
		const { link, quote, token } = await deposit();
		const payBy = validUntil(quote.expiresAt, KTM);

		const response = await client.get(depositPath(SLUG, token));

		assertApiData(response, {
			studio: { name: "Black Needle" },
			project: {
				brief: "A small fine-line moth on the forearm",
				artistName: "Sita",
			},
			deposit: {
				amount: 300_000,
				amountText: "NPR 3,000",
				due: 300_000,
				dueText: "NPR 3,000",
				currency: "NPR",
				payBy,
				payByText: formatDay(payBy),
			},
			referenceCode: link.referenceCode,
			state: "due",
			lastProofRejected: false,
			proofSubmittedAt: null,
			paymentMethods: [
				{
					kind: "esewa",
					label: "eSewa",
					qrImageUrl: null,
					accountName: "Black Needle",
					accountNumber: "9801234567",
					bankName: null,
				},
			],
			depositPolicy: "Deposits hold your date.",
		});
		response.assertHeader("cache-control", "no-store");
		assertApiHeaders(response);
	});

	test("a link that doesn't work is the same 404: unknown, malformed, replaced, expired, unknown studio", async ({
		client,
	}) => {
		const { tenant, project, token } = await deposit();
		const replaced = await inTenant(tenant, () =>
			services.links.issue(tenant, OWNER, project),
		);
		await inTenant(tenant, async () => {
			replaced.link.expiresAt = DateTime.utc().minus({ seconds: 1 });
			await replaced.link.save();
		});

		for (const path of [
			depositPath(SLUG, tokenFor(newTokenNonce())),
			depositPath(SLUG, "short"),
			depositPath(SLUG, `${"a".repeat(43)}=`),
			depositPath(SLUG, token),
			depositPath(SLUG, replaced.token),
			depositPath("no-such-studio-td65", replaced.token),
		]) {
			assertApiError(await client.get(path), 404, "not_found");
		}
	});

	test("a token the current APP_KEY no longer derives is the same 404 (rotation kills links)", async ({
		client,
	}) => {
		const { tenant, link, token } = await deposit();
		(await client.get(depositPath(SLUG, token))).assertStatus(200);

		// What a rotated APP_KEY does: the nonce no longer gives this token,
		// while the stored hash still matches it.
		await inTenant(tenant, async () => {
			link.tokenNonce = newTokenNonce();
			await link.save();
		});

		assertApiError(
			await client.get(depositPath(SLUG, token)),
			404,
			"not_found",
		);
	});
});

test.group("Public API: POST /deposits/:token", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("takes the screenshot: 201 with the page in submitted, a private image, the alert queued, no temp upload", async ({
		client,
		assert,
	}) => {
		const { tenant, project, token } = await deposit();
		const fake = queue.fake();
		const before = await tempUploads();

		const response = await postProof(client, SLUG, token, PROOF, [
			await proofPart(),
		]);

		response.assertStatus(201);
		response.assertHeader("cache-control", "no-store");
		assertApiHeaders(response);
		const page = response.body().data;
		assert.equal(page.state, "submitted");
		assert.isString(page.proofSubmittedAt);
		assert.deepEqual(page.paymentMethods, []);
		const payments = await paymentsOf(tenant, project.id);
		assert.deepEqual(
			payments.map((row) => [row.kind, row.status, row.amount, row.method]),
			[["deposit", "submitted", 300_000, "esewa"]],
		);
		assert.lengthOf(await storedProofs(tenant), 1);
		assert.notInclude(
			JSON.stringify(response.body()),
			payments[0].proofImageKey ?? "",
			"the answer never names the private image",
		);
		fake.assertPushed(DepositProofAlertJob, {
			payload: { tenantId: tenant.id, paymentId: payments[0].id },
		});
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("a JSON body is 415 for a live link, and the 404 for a dead one", async ({
		client,
	}) => {
		const { token } = await deposit();

		assertApiError(
			await client
				.post(depositPath(SLUG, token))
				.json({ method: "esewa", expectedAmount: 300_000 }),
			415,
			"unsupported_media_type",
		);
		assertApiError(
			await client
				.post(depositPath(SLUG, tokenFor(newTokenNonce())))
				.json({ method: "esewa", expectedAmount: 300_000 }),
			404,
			"not_found",
		);
	});

	test("a missing or wrong field is 422 with its message, and leaves no temp upload or row", async ({
		client,
		assert,
	}) => {
		const { tenant, project, token } = await deposit();
		const before = await tempUploads();
		const png = await proofPart();
		const cases: [
			Record<string, string>,
			(typeof png)[],
			Record<string, string[]>,
		][] = [
			[PROOF, [], { proof: [PROOF_MESSAGE] }],
			[{ ...PROOF, method: "cash" }, [png], { method: [METHOD_MESSAGE] }],
			// The studio doesn't show Khalti on its deposit page.
			[{ ...PROOF, method: "khalti" }, [png], { method: [METHOD_MESSAGE] }],
			[
				{ ...PROOF, expectedAmount: "abc" },
				[png],
				{ expectedAmount: [AMOUNT_MESSAGE] },
			],
			[
				PROOF,
				[
					{
						field: "proof",
						name: "moving.gif",
						type: "image/gif",
						data: await testImages.gif(),
					},
				],
				{ proof: [IMAGE_FORMAT_MESSAGE] },
			],
			[
				PROOF,
				[
					{
						field: "proof",
						name: "receipt.png",
						type: "image/png",
						data: Buffer.from("<?php echo 'hi'; ?>"),
					},
				],
				{ proof: [IMAGE_FORMAT_MESSAGE] },
			],
		];

		for (const [fields, parts, expected] of cases) {
			const response = await postProof(client, SLUG, token, fields, parts);
			assertApiError(response, 422, "validation_failed");
			assert.deepEqual(
				response.body().error.fields,
				expected,
				JSON.stringify(fields),
			);
		}

		assert.lengthOf(await paymentsOf(tenant, project.id), 0);
		assert.lengthOf(await storedProofs(tenant), 0);
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("a token the current APP_KEY no longer derives gets the 404 on upload: no row, no file, no temp upload", async ({
		client,
		assert,
	}) => {
		const { tenant, project, link, token } = await deposit();
		await inTenant(tenant, async () => {
			link.tokenNonce = newTokenNonce();
			await link.save();
		});
		const before = await tempUploads();

		assertApiError(
			await postProof(client, SLUG, token, PROOF, [await proofPart()]),
			404,
			"not_found",
		);

		assert.lengthOf(await paymentsOf(tenant, project.id), 0);
		assert.lengthOf(await storedProofs(tenant), 0);
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("a dead link's upload is the 404, before the body is read, with no temp upload left", async ({
		client,
		assert,
	}) => {
		await deposit();
		const before = await tempUploads();

		assertApiError(
			await postProof(client, SLUG, tokenFor(newTokenNonce()), PROOF, [
				await proofPart(),
			]),
			404,
			"not_found",
		);
		assert.deepEqual(await newTempUploads(before), []);
	});
});
