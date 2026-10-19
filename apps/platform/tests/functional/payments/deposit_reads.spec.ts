import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import type Quote from "#modules/projects/models/quote";
import ProjectService from "#modules/projects/services/project_service";
import QuoteService from "#modules/projects/services/quote_service";
import SessionService from "#modules/scheduling/services/session_service";
import { withTransaction } from "#services/db_context";
import {
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const images = new ImageService();
const quotes = new QuoteService();
const deposits = new DepositService(quotes);
const artists = new ArtistService(images);
const projects = new ProjectService(
	artists,
	quotes,
	deposits,
	new SessionService(artists, deposits),
);
const methods = new PaymentMethodService(images);

/** A decided payment: the database wants a decision time with the status. */
const decided = (status: "verified" | "rejected", at = DateTime.utc()) => ({
	status,
	verifiedAt: at,
});

/** A deposit_pending project with a fixed quote (deposit NPR 3,000 = 300,000 paisa). */
function quotedProject(
	tenant: { id: string },
	over: Parameters<typeof makeQuote>[2] = {},
) {
	return inTenant(tenant, async () => {
		const project = await makeProject(tenant, await makeClient(tenant), {
			status: "deposit_pending",
		});
		const quote: Quote = await makeQuote(tenant, project, over);
		return { project, quote };
	});
}

test.group("DepositService: what the deposit page reads", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("remaining is the deposit minus verified deposit money in the quote's currency, never below zero", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("reads-left-65");
		const { project, quote } = await quotedProject(tenant);
		const left = () =>
			inTenant(tenant, () => deposits.remaining(tenant, project, quote));

		assert.equal(await left(), 300_000);
		await inTenant(tenant, async () => {
			await makePayment(tenant, project, {
				amount: 100_000,
				...decided("verified"),
			});
			// None of these count: waiting, rejected, another kind, another currency.
			await makePayment(tenant, project, { amount: 50_000 });
			await makePayment(tenant, project, {
				amount: 50_000,
				...decided("rejected"),
			});
			await makePayment(tenant, project, {
				kind: "session",
				amount: 50_000,
				...decided("verified"),
			});
			await makePayment(tenant, project, {
				amount: 50_000,
				currency: "USD",
				...decided("verified"),
			});
		});
		assert.equal(await left(), 200_000);

		await inTenant(tenant, () =>
			makePayment(tenant, project, { amount: 500_000, ...decided("verified") }),
		);
		assert.equal(await left(), 0);
	});

	test("a zero deposit leaves nothing to pay", async ({ assert }) => {
		const { tenant } = await studioWithOwner("reads-zero-65");
		const { project, quote } = await quotedProject(tenant, {
			depositAmount: 0,
		});

		assert.equal(
			await inTenant(tenant, () => deposits.remaining(tenant, project, quote)),
			0,
		);
	});

	test("pendingProof is the submitted deposit payment; decided ones and other kinds aren't", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("reads-pending-65");
		const { project } = await quotedProject(tenant);
		const pending = () =>
			inTenant(tenant, () => deposits.pendingProof(tenant, project));

		assert.isNull(await pending());
		await inTenant(tenant, async () => {
			await makePayment(tenant, project, { kind: "session" });
			await makePayment(tenant, project, { ...decided("rejected") });
		});
		assert.isNull(await pending());

		const waiting = await inTenant(tenant, () => makePayment(tenant, project));
		assert.equal((await pending())?.id, waiting.id);
	});

	test("lastDecisionRejected follows the studio's latest decision on a deposit payment", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("reads-rejected-65");
		const { project } = await quotedProject(tenant);
		const rejected = () =>
			inTenant(tenant, () => deposits.lastDecisionRejected(tenant, project));

		assert.isFalse(await rejected());
		await inTenant(tenant, () =>
			makePayment(tenant, project, {
				...decided("rejected", DateTime.utc().minus({ hours: 2 })),
			}),
		);
		assert.isTrue(await rejected());
		// A waiting payment is no decision.
		await inTenant(tenant, () => makePayment(tenant, project));
		assert.isTrue(await rejected());
		await inTenant(tenant, () =>
			makePayment(tenant, project, {
				amount: 100_000,
				...decided("verified"),
			}),
		);
		assert.isFalse(await rejected());
	});

	test("countPendingProofs counts this studio's submitted deposit payments only", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("reads-count-a-65");
		const { tenant: other } = await studioWithOwner("reads-count-b-65");
		const one = await quotedProject(tenant);
		const two = await quotedProject(tenant);
		const theirs = await quotedProject(other);
		await inTenant(tenant, async () => {
			await makePayment(tenant, one.project);
			await makePayment(tenant, two.project);
			await makePayment(tenant, two.project, { kind: "session" });
			await makePayment(tenant, one.project, { ...decided("verified") });
		});
		await inTenant(other, () => makePayment(other, theirs.project));

		assert.equal(
			await inTenant(tenant, () => deposits.countPendingProofs(tenant)),
			2,
		);
		assert.equal(
			await inTenant(other, () => deposits.countPendingProofs(tenant)),
			0,
			"another studio's context counts none of this studio's",
		);
	});

	test("recordProof inserts a submitted deposit payment with its proof", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("reads-record-65");
		const { project } = await quotedProject(tenant);
		const proof = {
			key: `tenants/${tenant.id}/payment_proof/receipt.png`,
			width: 300,
			height: 200,
		};

		const payment = await inTenant(tenant, () =>
			deposits.recordProof(tenant, project, {
				amount: 300_000,
				currency: "NPR",
				method: "esewa",
				proof,
			}),
		);

		assert.deepEqual(
			[
				payment.tenantId,
				payment.projectId,
				payment.kind,
				payment.status,
				payment.amount,
				payment.currency,
				payment.method,
				payment.proofImageKey,
				payment.proofImageWidth,
				payment.proofImageHeight,
				payment.verifiedAt,
				payment.verifiedByUserId,
			],
			[
				tenant.id,
				project.id,
				"deposit",
				"submitted",
				300_000,
				"NPR",
				"esewa",
				proof.key,
				300,
				200,
				null,
				null,
			],
		);
	});
});

test.group("PaymentMethodService.listForDepositPage", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the live methods shown on the deposit page, in the owner's order", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("reads-methods-65");
		const listed = await inTenant(tenant, async () => {
			await methods.create(tenant, {
				kind: "bank",
				label: "NIC Asia",
				bankName: "NIC Asia Bank",
				accountName: "Black Needle",
				accountNumber: "0123456789",
				showOnDepositPage: true,
			});
			await methods.create(tenant, {
				kind: "esewa",
				label: "eSewa (hidden)",
				accountNumber: "9800000001",
			});
			await methods.create(tenant, { kind: "cash", label: "Cash" });
			const khalti = await methods.create(tenant, {
				kind: "khalti",
				label: "Khalti",
				accountNumber: "9800000002",
				showOnDepositPage: true,
			});
			const before = (await methods.listForDepositPage(tenant)).map(
				({ label }) => label,
			);
			await methods.delete(tenant, khalti);
			const after = (await methods.listForDepositPage(tenant)).map(
				({ label }) => label,
			);
			return { before, after };
		});

		assert.deepEqual(listed.before, ["NIC Asia", "Khalti"]);
		assert.deepEqual(listed.after, ["NIC Asia"]);
	});

	test("another studio's context sees none of them", async ({ assert }) => {
		const { tenant } = await studioWithOwner("reads-methods-a-65");
		const { tenant: other } = await studioWithOwner("reads-methods-b-65");
		await inTenant(tenant, () =>
			methods.create(tenant, {
				kind: "khalti",
				label: "Khalti",
				accountNumber: "9800000002",
				showOnDepositPage: true,
			}),
		);

		assert.lengthOf(
			await inTenant(other, () => methods.listForDepositPage(tenant)),
			0,
		);
	});
});

test.group("ProjectService.findLive and lockLive", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the studio's live project, else null: deleted, unknown, another studio's", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("reads-live-a-65");
		const { tenant: other } = await studioWithOwner("reads-live-b-65");
		const { project } = await quotedProject(tenant);
		const { project: gone } = await quotedProject(tenant);
		const { project: theirs } = await quotedProject(other);
		await inTenant(tenant, () => gone.softDelete());
		const find = (id: string) =>
			inTenant(tenant, () => projects.findLive(tenant, id));

		assert.equal((await find(project.id))?.id, project.id);
		assert.isNull(await find(gone.id));
		assert.isNull(await find(theirs.id));
		assert.isNull(await find("0195f3a0-0000-7000-8000-000000000065"));
	});

	test("lockLive reads the same rows inside a transaction", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("reads-lock-65");
		const { project } = await quotedProject(tenant);
		const { project: gone } = await quotedProject(tenant);
		await inTenant(tenant, () => gone.softDelete());
		const lock = (id: string) =>
			inTenant(tenant, () =>
				withTransaction((trx) => projects.lockLive(trx, tenant, id)),
			);

		assert.equal((await lock(project.id))?.id, project.id);
		assert.isNull(await lock(gone.id));
	});
});
