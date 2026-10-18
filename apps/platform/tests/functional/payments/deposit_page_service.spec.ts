import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import db from "@adonisjs/lucid/services/db";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { InvalidImageError } from "#modules/media/errors";
import { newTokenNonce, tokenFor } from "#modules/payments/deposit_links";
import {
	DepositPageNotFoundError,
	DepositProofError,
} from "#modules/payments/errors";
import DepositProofAlertJob from "#modules/payments/jobs/deposit_proof_alert_job";
import Payment from "#modules/payments/models/payment";
import DepositPageService, {
	type DepositStudio,
	type ProofSubmission,
} from "#modules/payments/services/deposit_page_service";
import ProjectService from "#modules/projects/services/project_service";
import SessionService from "#modules/scheduling/services/session_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { withDbContext } from "#services/db_context";
import { depositReady, depositServices, OWNER } from "#tests/helpers/deposits";
import {
	RecordingImageService,
	testImages,
	uploadOf,
} from "#tests/helpers/images";
import { makeArtist, makePayment } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Skips the pre-check, as if another submission landed between it and the
 * project's lock: only the check under the lock can refuse it.
 */
class RacingPages extends DepositPageService {
	protected override async precheck(tenant: DepositStudio, token: string) {
		return this.show(tenant, token);
	}
}

const verified = () => ({
	status: "verified" as const,
	verifiedAt: DateTime.utc(),
});

/** A studio with a deposit-pending project, its eSewa method and its link. */
async function studioWithDeposit(
	slug: string,
	services = depositServices(),
	quote: Parameters<typeof depositReady>[1] = {},
) {
	const { tenant } = await studioWithOwner(slug, "Black Needle");
	const ready = await inTenant(tenant, () => depositReady(tenant, quote));
	const issued = await inTenant(tenant, () =>
		services.links.issue(tenant, OWNER, ready.project),
	);
	return { tenant, services, ...ready, ...issued };
}

const submission = async (
	over: Partial<ProofSubmission> = {},
): Promise<ProofSubmission> => ({
	proof: await uploadOf(await testImages.png()),
	method: "esewa",
	expectedAmount: 300_000,
	...over,
});

const show = (
	services: ReturnType<typeof depositServices>,
	tenant: Tenant,
	token: string,
) => inTenant(tenant, () => services.pages.show(tenant, token));

/** The DepositProofError reason a refused submit gives, or null if it went through. */
async function reasonOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof DepositProofError) return error.reason;
		throw error;
	}
}

const paymentsOf = (tenant: { id: string }, projectId: string) =>
	inTenant(tenant, () =>
		Payment.query().where("project_id", projectId).orderBy("id"),
	);

const privateFile = (key: string) => drive.use("private").exists(key);

/** Rows in the queue table, committed or in the test's transaction. */
const queuedJobs = async () =>
	Number((await db.from("queue_jobs").count("* as total"))[0].total);

test.group("DepositPageService.show", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a due deposit: the studio, the brief and artist, what is due, the code, the methods and the policy", async ({
		assert,
	}) => {
		const { tenant, services, project, link, token } =
			await studioWithDeposit("page-due-65");
		await inTenant(tenant, async () => {
			tenant.merge({ depositPolicy: "Deposits hold your date." });
			await tenant.save();
			const artist = await makeArtist(tenant, "sita");
			project.artistId = artist.id;
			await project.save();
		});

		const page = await show(services, tenant, token);

		assert.deepEqual(
			{
				projectId: page.projectId,
				studioName: page.studioName,
				timezone: page.timezone,
				depositPolicy: page.depositPolicy,
				brief: page.brief,
				artistName: page.artistName,
				deposit: page.quote.depositAmount,
				due: page.due,
				referenceCode: page.referenceCode,
				state: page.state,
				lastProofRejected: page.lastProofRejected,
				proofSubmittedAt: page.proofSubmittedAt,
				methods: page.methods,
			},
			{
				projectId: project.id,
				studioName: "Black Needle",
				timezone: "Asia/Kathmandu",
				depositPolicy: "Deposits hold your date.",
				brief: "A small fine-line moth on the forearm",
				artistName: "Sita",
				deposit: 300_000,
				due: 300_000,
				referenceCode: link.referenceCode,
				state: "due",
				lastProofRejected: false,
				proofSubmittedAt: null,
				methods: [
					{
						kind: "esewa",
						label: "eSewa",
						accountName: "Black Needle",
						accountNumber: "9801234567",
						bankName: null,
						qrImageUrl: null,
					},
				],
			},
		);
	});

	test("a QR code shows by its public URL; hidden and cash methods don't show", async ({
		assert,
	}) => {
		const { tenant, services, token } = await studioWithDeposit("page-qr-65");
		await inTenant(tenant, async () => {
			await services.methods.create(tenant, {
				kind: "khalti",
				label: "Khalti",
				accountNumber: "9800000002",
				showOnDepositPage: true,
				qr: await uploadOf(await testImages.png()),
			});
			await services.methods.create(tenant, {
				kind: "bank",
				label: "Hidden bank",
				bankName: "NIC Asia Bank",
				accountName: "Black Needle",
				accountNumber: "0123456789",
			});
			await services.methods.create(tenant, { kind: "cash", label: "Cash" });
		});

		const { methods } = await show(services, tenant, token);

		assert.deepEqual(
			methods.map(({ label }) => label),
			["eSewa", "Khalti"],
		);
		assert.match(
			methods[1].qrImageUrl ?? "",
			new RegExp(`/uploads/tenants/${tenant.id}/payment_qr/`),
		);
	});

	test("each state, with payment methods only while due", async ({
		assert,
	}) => {
		const services = depositServices();
		const { tenant } = await studioWithOwner("page-states-65", "Black Needle");
		const made = async () => {
			const ready = await depositReady(tenant);
			const { token } = await services.links.issue(
				tenant,
				OWNER,
				ready.project,
			);
			return { ...ready, token };
		};
		const cases = await inTenant(tenant, async () => {
			const waiting = await made();
			const proof = await makePayment(tenant, waiting.project, {
				method: "esewa",
			});
			// Revised after the client paid: back in quoted, still paid (TAT-64).
			const paid = await made();
			await makePayment(tenant, paid.project, verified());
			paid.project.status = "quoted";
			await paid.project.save();
			const cancelled = await made();
			cancelled.project.status = "cancelled";
			await cancelled.project.save();
			const revising = await made();
			revising.project.status = "quoted";
			await revising.project.save();
			const expired = await made();
			expired.quote.expiresAt = DateTime.utc().minus({ minutes: 1 });
			await expired.quote.save();
			return { waiting, proof, paid, cancelled, revising, expired };
		});

		const waiting = await show(services, tenant, cases.waiting.token);
		assert.equal(waiting.state, "submitted");
		assert.equal(
			waiting.proofSubmittedAt?.toMillis(),
			cases.proof.createdAt.toMillis(),
		);
		for (const [name, state] of [
			["paid", "paid"],
			["cancelled", "cancelled"],
			["revising", "updating"],
			["expired", "expired"],
		] as const) {
			const page = await show(services, tenant, cases[name].token);
			assert.equal(page.state, state, name);
			assert.deepEqual(page.methods, [], name);
		}
		assert.equal((await show(services, tenant, cases.paid.token)).due, 0);
		assert.deepEqual(waiting.methods, []);
	});

	test("a rejected last screenshot is flagged on the due page", async ({
		assert,
	}) => {
		const { tenant, services, project, token } =
			await studioWithDeposit("page-rejected-65");
		await inTenant(tenant, () =>
			makePayment(tenant, project, {
				status: "rejected",
				verifiedAt: DateTime.utc(),
			}),
		);

		const page = await show(services, tenant, token);

		assert.equal(page.state, "due");
		assert.isTrue(page.lastProofRejected);
	});

	test("a quote revised while the page is read never shows as due with the revised terms", async ({
		assert,
	}) => {
		const base = depositServices();
		const { tenant, project, quote, token } = await studioWithDeposit(
			"page-revising-65",
			base,
		);
		// Commits a revision right after the project is read, the moment a
		// read of the project followed by a read of the quote would straddle.
		class RevisingProjects extends ProjectService {
			revise?: () => Promise<unknown>;

			override async findLive(...args: Parameters<ProjectService["findLive"]>) {
				const live = await super.findLive(...args);
				await this.revise?.();
				return live;
			}
		}
		const projects = new RevisingProjects(
			base.artists,
			base.quotes,
			base.deposits,
			new SessionService(base.artists, base.deposits),
		);
		const pages = new DepositPageService(
			base.links,
			projects,
			base.quotes,
			base.deposits,
			base.methods,
			base.artists,
			base.images,
		);
		queue.fake();
		try {
			projects.revise = () =>
				base.projects.issueQuote(
					tenant,
					OWNER,
					project,
					{
						kind: "fixed",
						fixedPrice: 2_000_000,
						depositAmount: 500_000,
						expiresAt: DateTime.utc().plus({ days: 14 }),
					},
					quote.id,
				);

			const page = await inTenant(tenant, () => pages.show(tenant, token));

			assert.isTrue(
				page.state !== "due" || page.quote.id === quote.id,
				`the page says ${page.state} with a quote that is not the one the client accepted`,
			);
		} finally {
			queue.restore();
		}
	});

	test("a dead link is DepositPageNotFoundError: unknown, replaced, expired, deleted project, another studio's", async ({
		assert,
	}) => {
		const mine = await studioWithDeposit("page-dead-a-65");
		const theirs = await studioWithDeposit("page-dead-b-65", mine.services);
		const { tenant, services, project, link, token } = mine;
		const dead = (candidate: string) =>
			assert.rejects(
				() => show(services, tenant, candidate),
				DepositPageNotFoundError,
			);

		await dead(tokenFor(newTokenNonce()));
		await dead(theirs.token);

		const replaced = await inTenant(tenant, () =>
			services.links.issue(tenant, OWNER, project),
		);
		await dead(token);

		await inTenant(tenant, async () => {
			link.merge({ expiresAt: DateTime.utc().minus({ seconds: 1 }) });
			await link.save();
		});
		await dead(replaced.token);

		const other = await inTenant(tenant, async () => {
			const ready = await depositReady(tenant);
			const issued = await services.links.issue(tenant, OWNER, ready.project);
			await ready.project.softDelete();
			return issued;
		});
		await dead(other.token);
	});
});

test.group("DepositPageService.submitProof", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("records a submitted deposit payment with its private image, queues the alert, and answers in submitted", async ({
		assert,
	}) => {
		const images = new RecordingImageService();
		const { tenant, services, project, token } = await studioWithDeposit(
			"proof-take-65",
			depositServices(images),
		);
		const fake = queue.fake();

		const page = await inTenant(tenant, async () =>
			services.pages.submitProof(tenant, token, await submission()),
		);

		assert.equal(page.state, "submitted");
		assert.deepEqual(page.methods, []);
		const payments = await paymentsOf(tenant, project.id);
		assert.deepEqual(
			payments.map((row) => [
				row.kind,
				row.status,
				row.amount,
				row.currency,
				row.method,
				row.proofImageKey,
				row.proofImageWidth,
				row.proofImageHeight,
			]),
			[
				[
					"deposit",
					"submitted",
					300_000,
					"NPR",
					"esewa",
					images.keys[0],
					300,
					200,
				],
			],
		);
		assert.match(
			images.keys[0],
			new RegExp(`^tenants/${tenant.id}/payment_proof/`),
		);
		assert.isTrue(await privateFile(images.keys[0]));
		fake.assertPushed(DepositProofAlertJob, {
			payload: { tenantId: tenant.id, paymentId: payments[0].id },
		});
		fake.assertPushedCount(1);
	});

	test("it records what is still due, and refuses the amount the page no longer shows", async ({
		assert,
	}) => {
		const { tenant, services, project, token } =
			await studioWithDeposit("proof-due-65");
		await inTenant(tenant, () =>
			makePayment(tenant, project, { amount: 100_000, ...verified() }),
		);

		assert.equal(
			await reasonOf(async () =>
				inTenant(tenant, async () =>
					services.pages.submitProof(tenant, token, await submission()),
				),
			),
			"amount_changed",
		);
		await inTenant(tenant, async () =>
			services.pages.submitProof(
				tenant,
				token,
				await submission({ expectedAmount: 200_000 }),
			),
		);

		const waiting = (await paymentsOf(tenant, project.id)).filter(
			(row) => row.status === "submitted",
		);
		assert.deepEqual(
			waiting.map((row) => row.amount),
			[200_000],
		);
	});

	test("every refusal comes before the image is decoded, and changes nothing", async ({
		assert,
	}) => {
		const images = new RecordingImageService();
		const services = depositServices(images);
		const { tenant } = await studioWithOwner("proof-refuse-65", "Black Needle");
		const made = async () => {
			const ready = await depositReady(tenant);
			const { token } = await services.links.issue(
				tenant,
				OWNER,
				ready.project,
			);
			return { ...ready, token };
		};
		const cases = await inTenant(tenant, async () => {
			const waiting = await made();
			await makePayment(tenant, waiting.project, { method: "esewa" });
			const paid = await made();
			await makePayment(tenant, paid.project, verified());
			const cancelled = await made();
			cancelled.project.status = "cancelled";
			await cancelled.project.save();
			const expired = await made();
			expired.quote.expiresAt = DateTime.utc().minus({ minutes: 1 });
			await expired.quote.save();
			const due = await made();
			return [
				[waiting.token, {}, "not_due"],
				[paid.token, {}, "not_due"],
				[cancelled.token, {}, "not_due"],
				[expired.token, {}, "not_due"],
				[due.token, { method: "khalti" }, "method_unavailable"],
				[due.token, { expectedAmount: 250_000 }, "amount_changed"],
			] as const;
		});
		const before = await inTenant(tenant, () => Payment.query().orderBy("id"));

		for (const [token, over, reason] of cases) {
			assert.equal(
				await reasonOf(async () =>
					inTenant(tenant, async () =>
						services.pages.submitProof(tenant, token, await submission(over)),
					),
				),
				reason,
				reason,
			);
		}

		assert.deepEqual(images.keys, [], "no image was decoded");
		assert.deepEqual(
			(await inTenant(tenant, () => Payment.query().orderBy("id"))).map(
				({ id }) => id,
			),
			before.map(({ id }) => id),
		);
	});

	test("an upload that isn't an image is InvalidImageError, and nothing is kept", async ({
		assert,
	}) => {
		const { tenant, services, project, token } =
			await studioWithDeposit("proof-fake-65");

		await assert.rejects(
			async () =>
				inTenant(tenant, async () =>
					services.pages.submitProof(
						tenant,
						token,
						await submission({
							proof: await uploadOf(Buffer.from("<?php echo 'hi'; ?>")),
						}),
					),
				),
			InvalidImageError,
		);
		assert.lengthOf(await paymentsOf(tenant, project.id), 0);
	});

	test("a submission that loses the race under the lock is refused, and its stored image is deleted", async ({
		assert,
	}) => {
		const images = new RecordingImageService();
		const services = depositServices(images);
		const racing = new RacingPages(
			services.links,
			services.projects,
			services.quotes,
			services.deposits,
			services.methods,
			services.artists,
			images,
		);
		const { tenant, project, token } = await studioWithDeposit(
			"proof-race-65",
			services,
		);
		const winner = await inTenant(tenant, () =>
			makePayment(tenant, project, { method: "esewa" }),
		);

		assert.equal(
			await reasonOf(async () =>
				inTenant(tenant, async () =>
					racing.submitProof(tenant, token, await submission()),
				),
			),
			"not_due",
		);
		assert.lengthOf(images.keys, 1, "the image was stored before the lock");
		assert.isFalse(await privateFile(images.keys[0]));
		assert.deepEqual(
			(await paymentsOf(tenant, project.id)).map(({ id }) => id),
			[winner.id],
		);
	});

	test("a failure later in the request deletes the image and drops the alert", async ({
		assert,
	}) => {
		const images = new RecordingImageService();
		const { tenant, services, project, token } = await studioWithDeposit(
			"proof-later-65",
			depositServices(images),
		);
		const before = await queuedJobs();

		await assert.rejects(
			() =>
				withDbContext({ tenantId: tenant.id }, async () => {
					await services.pages.submitProof(tenant, token, await submission());
					throw new Error("later failure");
				}),
			"later failure",
		);

		assert.lengthOf(images.keys, 1);
		assert.isFalse(await privateFile(images.keys[0]));
		assert.lengthOf(await paymentsOf(tenant, project.id), 0);
		assert.equal(await queuedJobs(), before);

		// The positive control: a submission that commits leaves its job.
		await inTenant(tenant, async () =>
			services.pages.submitProof(tenant, token, await submission()),
		);
		assert.equal(await queuedJobs(), before + 1);
	});
});
