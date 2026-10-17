import { inject } from "@adonisjs/core";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
import type { DateTime } from "luxon";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import {
	type DepositMethodKind,
	type DepositState,
	depositState,
} from "#modules/payments/deposit_page";
import {
	DepositPageNotFoundError,
	DepositProofError,
} from "#modules/payments/errors";
import DepositProofAlertJob from "#modules/payments/jobs/deposit_proof_alert_job";
import type PaymentMethod from "#modules/payments/models/payment_method";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositLinkService from "#modules/payments/services/deposit_link_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import type Quote from "#modules/projects/models/quote";
import { isExpired } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import QuoteService from "#modules/projects/services/quote_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { afterRollback, withTransaction } from "#services/db_context";
import { dispatchInTransaction } from "#services/queue";

/** What the page needs of the studio: the public tenant the path resolved. */
export type DepositStudio = Pick<
	Tenant,
	"id" | "name" | "timezone" | "depositPolicy"
>;

/** A payment method as the page shows it: the kind's own details and a public QR URL. */
export type ShownMethod = Pick<
	PaymentMethod,
	"kind" | "label" | "accountName" | "accountNumber" | "bankName"
> & { qrImageUrl: string | null };

/** The deposit page of one link (openapi.yaml, DepositPage, before formatting). */
export type DepositPage = {
	projectId: string;
	studioName: string;
	timezone: string;
	depositPolicy: string | null;
	brief: string;
	artistName: string | null;
	/** The project's current quote: its deposit, currency and expiry. */
	quote: Quote;
	/** What is still to pay, in minor units (DepositService.remaining). */
	due: number;
	referenceCode: string;
	state: DepositState;
	/** In `due`: the studio rejected the last screenshot. */
	lastProofRejected: boolean;
	/** When the screenshot that waits was sent, or null. */
	proofSubmittedAt: DateTime | null;
	/** The studio's deposit-page methods, only in `due`; otherwise empty. */
	methods: ShownMethod[];
};

/** A validated proof: the upload, how the client paid and the `due` the page showed. */
export type ProofSubmission = {
	proof: Pick<MultipartFile, "tmpPath">;
	method: DepositMethodKind;
	expectedAmount: number;
};

const PURPOSE = "payment_proof";

/**
 * The public deposit page (TAT-65): what a link's token shows, and the one
 * write it takes, the client's payment screenshot. The tenant comes from
 * the path (the public API's request transaction, in its RLS context); a
 * link that doesn't work is DepositPageNotFoundError, whatever the reason.
 */
@inject()
export default class DepositPageService {
	constructor(
		private links: DepositLinkService,
		private projects: ProjectService,
		private quotes: QuoteService,
		private deposits: DepositService,
		private methods: PaymentMethodService,
		private artists: ArtistService,
		private images: ImageService,
	) {}

	/**
	 * The page of `token`: the live link, its live project and the current
	 * quote, else DepositPageNotFoundError. A link is only made for a quoted
	 * project and quotes are never deleted, so a missing quote is a dead
	 * link too. Payment methods come only while the deposit is due.
	 */
	async show(tenant: DepositStudio, token: string): Promise<DepositPage> {
		const link = await this.links.resolve(tenant, token);
		const project = link
			? await this.projects.findLive(tenant, link.projectId)
			: null;
		const quote = project ? await this.quotes.current(tenant, project) : null;
		if (!link || !project || !quote) throw new DepositPageNotFoundError();

		const due = await this.deposits.remaining(tenant, project, quote);
		const pending = await this.deposits.pendingProof(tenant, project);
		const state = depositState({
			status: project.status,
			quoteExpired: isExpired(quote),
			settled: due === 0,
			proofPending: pending !== null,
		});
		return {
			projectId: project.id,
			studioName: tenant.name,
			timezone: tenant.timezone,
			depositPolicy: tenant.depositPolicy,
			brief: project.brief,
			artistName: await this.artistName(tenant, project.artistId),
			quote,
			due,
			referenceCode: link.referenceCode,
			state,
			lastProofRejected:
				state === "due" &&
				(await this.deposits.lastDecisionRejected(tenant, project)),
			proofSubmittedAt: pending?.createdAt ?? null,
			methods: state === "due" ? await this.shownMethods(tenant) : [],
		};
	}

	/**
	 * Records the client's screenshot as a `submitted` deposit payment of
	 * what is due, all or nothing, and queues the owners' alert. The page is
	 * checked first (DepositProofError: `not_due`, `method_unavailable`,
	 * `amount_changed`), so a refusal decodes no image. Then the image is
	 * stored with its deletion registered at once, before any row lock (the
	 * backend conventions), the project is locked and the page checked
	 * again: a submission that lost a race to another one is refused there,
	 * and its savepoint's rollback deletes its image. InvalidImageError for
	 * an upload that isn't an image we take. Returns the page as it now is
	 * (`submitted`).
	 */
	async submitProof(
		tenant: DepositStudio,
		token: string,
		submission: ProofSubmission,
	): Promise<DepositPage> {
		const before = await this.precheck(tenant, token, submission);
		return withTransaction(async (trx) => {
			const proof = await this.images.store(submission.proof, {
				tenant,
				purpose: PURPOSE,
			});
			afterRollback(() => this.images.delete(PURPOSE, proof.key));

			const project = await this.projects.lockLive(
				trx,
				tenant,
				before.projectId,
			);
			if (!project) throw new DepositPageNotFoundError();
			const now = await this.show(tenant, token);
			assertTakes(now, submission);

			const payment = await this.deposits.recordProof(tenant, project, {
				amount: now.due,
				currency: now.quote.currency,
				method: submission.method,
				proof,
			});
			await dispatchInTransaction(
				DepositProofAlertJob.dispatch({
					tenantId: tenant.id,
					paymentId: payment.id,
				}),
				trx,
			);
			return this.show(tenant, token);
		});
	}

	/**
	 * The page before anything is stored, refusing what can be refused
	 * already. Protected, so a test can skip it to stage a race that only the
	 * check under the lock can catch.
	 */
	protected async precheck(
		tenant: DepositStudio,
		token: string,
		submission: ProofSubmission,
	): Promise<DepositPage> {
		const page = await this.show(tenant, token);
		assertTakes(page, submission);
		return page;
	}

	private async artistName(
		tenant: DepositStudio,
		artistId: string | null,
	): Promise<string | null> {
		if (!artistId) return null;
		const artists = await this.artists.list(tenant);
		return artists.find(({ id }) => id === artistId)?.name ?? null;
	}

	private async shownMethods(tenant: DepositStudio): Promise<ShownMethod[]> {
		const methods = await this.methods.listForDepositPage(tenant);
		return Promise.all(
			methods.map(async (method) => ({
				kind: method.kind,
				label: method.label,
				accountName: method.accountName,
				accountNumber: method.accountNumber,
				bankName: method.bankName,
				qrImageUrl: method.qrImageKey
					? await this.images.url("payment_qr", method.qrImageKey)
					: null,
			})),
		);
	}
}

/** Refuses a proof the page can't take: not due, a method it doesn't list, a stale amount. */
function assertTakes(
	page: DepositPage,
	{
		method,
		expectedAmount,
	}: Pick<ProofSubmission, "method" | "expectedAmount">,
) {
	if (page.state !== "due") throw new DepositProofError("not_due");
	if (!page.methods.some(({ kind }) => kind === method)) {
		throw new DepositProofError("method_unavailable");
	}
	if (expectedAmount !== page.due) {
		throw new DepositProofError("amount_changed");
	}
}
