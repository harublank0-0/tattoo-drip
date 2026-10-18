import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import DepositOutcome from "#modules/payments/models/deposit_outcome";
import Payment from "#modules/payments/models/payment";
import type TattooProject from "#modules/projects/models/tattoo_project";
import { depositReady } from "#tests/helpers/deposits";
import { proofFor } from "#tests/helpers/payments";
import {
	makeArtist,
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const SLUG = "pay-needle-66";
const page = (id: string) => `/t/${SLUG}/projects/${id}`;
const AMOUNT =
	"Enter an amount from 0.01 to 1,00,00,000 rupees, with at most 2 decimals.";

function post(
	client: ApiClient,
	user: User,
	url: string,
	form: Record<string, string> = {},
) {
	return client.post(url).form(form).withCsrfToken().loginAs(user).redirects(0);
}

/** A studio with a deposit_pending project whose screenshot waits. */
async function waiting() {
	const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
	const { project } = await inTenant(tenant, () => depositReady(tenant));
	const proof = await inTenant(tenant, () => proofFor(tenant, project));
	return { owner, tenant, project, proof };
}

/** A project in `status` with the default quote and a verified NPR 3,000 deposit. */
async function holding(
	tenant: { id: string },
	status: TattooProject["status"],
) {
	return inTenant(tenant, async () => {
		const project = await makeProject(tenant, await makeClient(tenant), {
			status,
		});
		await makeQuote(tenant, project);
		const deposit = await makePayment(tenant, project, {
			status: "verified",
			verifiedAt: DateTime.utc(),
		});
		return { project, deposit };
	});
}

const reload = <T extends Payment | TattooProject>(
	tenant: { id: string },
	model: T,
) =>
	inTenant(tenant, async () => {
		await model.refresh();
		return model;
	});

test.group("Payment decisions over HTTP", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("verifying books the project when a session is scheduled", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project, proof } = await waiting();
		await inTenant(tenant, async () =>
			makeSession(tenant, project, await makeArtist(tenant)),
		);

		const response = await post(
			client,
			owner,
			`/t/${SLUG}/payments/${proof.id}/verify`,
			{
				note: "On the eSewa statement",
			},
		);

		response.assertStatus(302);
		response.assertHeader("location", page(project.id));
		response.assertFlashMessage(
			"success",
			"Payment verified. The project is booked.",
		);
		assert.equal((await reload(tenant, proof)).note, "On the eSewa statement");
	});

	test("without a session the flash says what to do; a partial deposit says what is left", async ({
		client,
	}) => {
		const covered = await waiting();
		(
			await post(
				client,
				covered.owner,
				`/t/${SLUG}/payments/${covered.proof.id}/verify`,
			)
		).assertFlashMessage(
			"success",
			"Payment verified. Schedule a tattoo session to book the project.",
		);

		const { owner, tenant } = await studioWithOwner("pay-part-66", "Part");
		const { project } = await inTenant(tenant, () =>
			depositReady(tenant, { depositAmount: 400_000 }),
		);
		const partial = await inTenant(tenant, () =>
			proofFor(tenant, project, { amount: 100_000 }),
		);
		(
			await post(client, owner, `/t/pay-part-66/payments/${partial.id}/verify`)
		).assertFlashMessage(
			"success",
			"Payment verified. NPR 3,000 of the deposit is still due.",
		);
	});

	test("a second Verify is a flash, not an error", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, proof } = await waiting();
		await post(client, owner, `/t/${SLUG}/payments/${proof.id}/verify`);

		const again = await post(
			client,
			owner,
			`/t/${SLUG}/payments/${proof.id}/reject`,
		);

		again.assertStatus(302);
		again.assertFlashMessage(
			"error",
			"This payment was already verified or rejected. Check the list.",
		);
		assert.equal((await reload(tenant, proof)).status, "verified");
	});

	test("rejecting tells the owner the deposit page asks again", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, proof } = await waiting();

		const response = await post(
			client,
			owner,
			`/t/${SLUG}/payments/${proof.id}/reject`,
			{
				note: "Not on the statement",
			},
		);

		response.assertFlashMessage(
			"success",
			"Screenshot rejected. The deposit page now asks the client for a new one.",
		);
		assert.equal((await reload(tenant, proof)).status, "rejected");
	});

	test("the Projects badge drops after a decision", async ({
		client,
		assert,
	}) => {
		const { owner, proof } = await waiting();
		const badge = async () =>
			(await client.get(`/t/${SLUG}/projects`).withInertia().loginAs(owner))
				.inertiaProps.proofCount;

		assert.equal(await badge(), 1);
		await post(client, owner, `/t/${SLUG}/payments/${proof.id}/verify`);
		assert.equal(await badge(), 0);
	});
});

test.group(
	"Desk payments, refunds, reversals and outcomes over HTTP",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("an owner records a desk payment in rupees with paisa", async ({
			client,
			assert,
		}) => {
			const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
			const { project } = await holding(tenant, "booked");

			const response = await post(
				client,
				owner,
				`${page(project.id)}/payments`,
				{
					kind: "balance",
					method: "khalti",
					amount: "12345.67",
					note: "Rest after the session",
				},
			);

			response.assertFlashMessage("success", "Payment recorded.");
			const payment = await inTenant(tenant, () =>
				Payment.query()
					.where("project_id", project.id)
					.where("kind", "balance")
					.firstOrFail(),
			);
			assert.deepEqual(
				[payment.amount, payment.method, payment.status, payment.note],
				[1_234_567, "khalti", "verified", "Rest after the session"],
			);
		});

		test("a bad amount, kind, method or note is a field error", async ({
			client,
		}) => {
			const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
			const { project } = await holding(tenant, "booked");
			const form = (over: Record<string, string>) => ({
				kind: "balance",
				method: "cash",
				amount: "1000",
				...over,
			});

			for (const amount of ["0", "12.345", "10000000.01", "", "abc"]) {
				assertValidationError(
					await post(
						client,
						owner,
						`${page(project.id)}/payments`,
						form({ amount }),
					),
					"amount",
					AMOUNT,
				);
			}
			assertValidationError(
				await post(
					client,
					owner,
					`${page(project.id)}/payments`,
					form({ kind: "refund" }),
				),
				"kind",
				"Choose what was paid.",
			);
			assertValidationError(
				await post(
					client,
					owner,
					`${page(project.id)}/payments`,
					form({ method: "card" }),
				),
				"method",
				"Choose how it was paid.",
			);
			assertValidationError(
				await post(
					client,
					owner,
					`${page(project.id)}/payments`,
					form({ note: "x".repeat(501) }),
				),
				"note",
				"Keep it under 500 characters.",
			);
		});

		test("a desk deposit outside deposit_pending is a flash error", async ({
			client,
		}) => {
			const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
			const { project } = await holding(tenant, "booked");

			const response = await post(
				client,
				owner,
				`${page(project.id)}/payments`,
				{
					kind: "deposit",
					method: "cash",
					amount: "3000",
				},
			);

			response.assertFlashMessage(
				"error",
				"A deposit can be recorded only while the project waits for it. Mark the quote accepted first.",
			);
		});

		test("a refund over what the project holds is a field error on amount", async ({
			client,
		}) => {
			const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
			const { project } = await holding(tenant, "booked");

			const ok = await post(client, owner, `${page(project.id)}/refunds`, {
				method: "cash",
				amount: "1000",
			});
			ok.assertFlashMessage("success", "Refund recorded.");
			assertValidationError(
				await post(client, owner, `${page(project.id)}/refunds`, {
					method: "cash",
					amount: "2500",
				}),
				"amount",
				"You can refund at most NPR 2,000.",
			);
		});

		test("an owner reverses a deposit; the flash says it is due again; a second reversal is refused", async ({
			client,
		}) => {
			const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
			const { deposit } = await holding(tenant, "booked");

			const first = await post(
				client,
				owner,
				`/t/${SLUG}/payments/${deposit.id}/reverse`,
				{
					note: "Never reached the account",
				},
			);
			first.assertFlashMessage(
				"success",
				"Payment reversed. NPR 3,000 of the deposit is due again.",
			);
			const second = await post(
				client,
				owner,
				`/t/${SLUG}/payments/${deposit.id}/reverse`,
			);
			second.assertFlashMessage("error", "This payment was already reversed.");
		});

		test("an owner records a closed project's deposit outcome; a refund needs its amount and method", async ({
			client,
			assert,
		}) => {
			const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
			const kept = await holding(tenant, "cancelled");
			const refunded = await holding(tenant, "cancelled");

			(
				await post(client, owner, `${page(kept.project.id)}/deposit-outcome`, {
					outcome: "kept",
				})
			).assertFlashMessage(
				"success",
				"Recorded: the studio keeps the deposit.",
			);

			const missing = await post(
				client,
				owner,
				`${page(refunded.project.id)}/deposit-outcome`,
				{
					outcome: "refunded",
				},
			);
			assertValidationError(missing, "amount", AMOUNT);
			assertValidationError(missing, "method", "Choose how it was paid.");

			(
				await post(
					client,
					owner,
					`${page(refunded.project.id)}/deposit-outcome`,
					{
						outcome: "refunded",
						amount: "2000",
						method: "esewa",
					},
				)
			).assertFlashMessage(
				"success",
				"Recorded: NPR 2,000 of the deposit refunded.",
			);

			const outcomes = await inTenant(tenant, () =>
				DepositOutcome.query().whereIn("project_id", [
					kept.project.id,
					refunded.project.id,
				]),
			);
			assert.sameMembers(
				outcomes.map(({ outcome }) => outcome),
				["kept", "refunded"],
			);
			(
				await post(client, owner, `${page(kept.project.id)}/deposit-outcome`, {
					outcome: "kept",
				})
			).assertFlashMessage(
				"error",
				"There's no deposit outcome to record for this project.",
			);
		});

		test("the assigned artist gets a 404 on every payment write", async ({
			client,
			assert,
		}) => {
			const { tenant, project, proof } = await waiting();
			const asha = await artistIn(tenant, `asha@${SLUG}.example`);
			const { deposit } = await holding(tenant, "booked");
			const closed = await holding(tenant, "cancelled");
			await inTenant(tenant, async () => {
				const profile = await makeArtist(tenant, "asha");
				profile.userId = asha.id;
				await profile.save();
				for (const mine of [project, closed.project]) {
					mine.artistId = profile.id;
					await mine.save();
				}
			});

			for (const [url, form] of [
				[`/t/${SLUG}/payments/${proof.id}/verify`, {}],
				[`/t/${SLUG}/payments/${proof.id}/reject`, {}],
				[`/t/${SLUG}/payments/${deposit.id}/reverse`, {}],
				[
					`${page(project.id)}/payments`,
					{ kind: "session", method: "cash", amount: "1000" },
				],
				[`${page(project.id)}/refunds`, { method: "cash", amount: "1" }],
				[`${page(closed.project.id)}/deposit-outcome`, { outcome: "kept" }],
			] as const) {
				(await post(client, asha, url, form)).assertStatus(404);
			}
			assert.equal((await reload(tenant, proof)).status, "submitted");
		});
	},
);
