import { inject } from "@adonisjs/core";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { DateTime } from "luxon";
import {
	DEPOSIT_LINK_DAYS,
	depositPageUrl,
	hashToken,
	newReferenceCode,
	newTokenNonce,
	tokenFor,
} from "#modules/payments/deposit_links";
import {
	DepositLinkRuleError,
	type DepositLinkRuleReason,
} from "#modules/payments/errors";
import DepositLink from "#modules/payments/models/deposit_link";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import type TattooProject from "#modules/projects/models/tattoo_project";
import { isExpired } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService, {
	type Member,
} from "#modules/projects/services/project_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import QuoteService from "#modules/projects/services/quote_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";
import { isUniqueViolation } from "#services/db_errors";

type TenantRef = Pick<Tenant, "id">;
type ProjectRef = Pick<TattooProject, "id">;
type Fresh = Pick<DepositLink, "tokenNonce" | "tokenHash" | "expiresAt">;

/**
 * Draws of a reference code before giving up. Each existing code makes a
 * collision a 1 in 729 million event, so a studio never gets here.
 */
export const REFERENCE_TRIES = 5;

const CODE_TAKEN = "deposit_links_tenant_id_reference_code_unique";

/**
 * The link's token while the link works, else null: not expired, and the
 * row's nonce still derives the token whose hash is stored. Rotating
 * APP_KEY changes what tokenFor gives, so the derivation stops matching
 * and every link dies, for the public page (resolve) and the owner's panel
 * (forProject) alike. Both sides of the comparison come from the server.
 */
function liveToken(link: DepositLink): string | null {
	if (link.expiresAt.toMillis() <= DateTime.now().toMillis()) return null;
	const token = tokenFor(link.tokenNonce);
	return hashToken(token) === link.tokenHash ? token : null;
}

/**
 * Deposit links (TAT-65): one per project, the bearer link to its public
 * deposit page. Owners make or replace a link; the public API resolves a
 * token to its link. The token is derived from the row's nonce (tokenFor)
 * and never stored.
 */
@inject()
export default class DepositLinkService {
	constructor(
		private projects: ProjectService,
		private quotes: QuoteService,
		private deposits: DepositService,
		private methods: PaymentMethodService,
	) {}

	/**
	 * Makes the project's deposit link, or replaces it: a new token that
	 * works for DEPOSIT_LINK_DAYS, the old one dead at once. The reference
	 * code is drawn with the first link and kept. Owners only: anyone else
	 * gets E_ROW_NOT_FOUND (a 404, like a project that isn't theirs). Under
	 * the project's lock, issueProblem must find nothing, else
	 * DepositLinkRuleError. Returns the link, its token and whether it
	 * replaced an earlier one.
	 */
	async issue(
		tenant: TenantRef,
		member: Member,
		project: ProjectRef,
	): Promise<{ link: DepositLink; token: string; replaced: boolean }> {
		if (member.role !== "owner") {
			throw new lucidErrors.E_ROW_NOT_FOUND(DepositLink);
		}
		return withTransaction(async (trx) => {
			const live = await this.projects.lockLive(trx, tenant, project.id);
			if (!live) throw new lucidErrors.E_ROW_NOT_FOUND(DepositLink);
			const problem = await this.issueProblem(tenant, live);
			if (problem) throw new DepositLinkRuleError(problem);

			const tokenNonce = newTokenNonce();
			const token = tokenFor(tokenNonce);
			const fresh: Fresh = {
				tokenNonce,
				tokenHash: hashToken(token),
				expiresAt: DateTime.now().plus({ days: DEPOSIT_LINK_DAYS }),
			};
			const existing = await DepositLink.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("project_id", live.id)
				.forUpdate()
				.first();
			if (existing) {
				existing.merge(fresh);
				await existing.save();
				return { link: existing, token, replaced: true };
			}
			const link = await this.insertWithCode(tenant, live, fresh);
			return { link, token, replaced: false };
		});
	}

	/**
	 * What stops an owner from making the project's link now, or null: it
	 * must be deposit_pending, with a current quote that hasn't expired, a
	 * deposit that isn't covered (a zero deposit is covered), and at least
	 * one method on the deposit page. The project page shows the reason.
	 */
	async issueProblem(
		tenant: TenantRef,
		project: TattooProject,
	): Promise<DepositLinkRuleReason | null> {
		if (project.status !== "deposit_pending") return "not_deposit_pending";
		const quote = await this.quotes.current(tenant, project);
		if (!quote || isExpired(quote)) return "quote_expired";
		if (await this.deposits.isSettled(tenant, project)) return "nothing_due";
		const shown = await this.methods.listForDepositPage(tenant);
		if (shown.length === 0) return "no_payment_methods";
		return null;
	}

	/**
	 * The link of `token` in this tenant while it works, else null: unknown,
	 * replaced, expired, another tenant's and tokens an earlier APP_KEY made
	 * are all null. Looked up by the token's hash, never the token; then the
	 * row's nonce must still derive that hash (liveToken), because a token
	 * handed out before an APP_KEY rotation still hashes to the stored value.
	 */
	async resolve(tenant: TenantRef, token: string): Promise<DepositLink | null> {
		const link = await DepositLink.query()
			.where("tenant_id", tenant.id)
			.where("token_hash", hashToken(token))
			.first();
		return link && liveToken(link) ? link : null;
	}

	/**
	 * The project's link for its owner's page, or null when it has none: the
	 * URL rebuilt from the nonce (null once the link expired, or when the
	 * hash no longer matches because APP_KEY was rotated), the reference
	 * code and the expiry.
	 */
	async forProject(
		tenant: Pick<Tenant, "id" | "slug">,
		project: ProjectRef,
	): Promise<{
		referenceCode: string;
		expiresAt: DateTime;
		url: string | null;
	} | null> {
		const link = await DepositLink.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.first();
		if (!link) return null;
		const token = liveToken(link);
		return {
			referenceCode: link.referenceCode,
			expiresAt: link.expiresAt,
			url: token ? depositPageUrl(tenant.slug, token) : null,
		};
	}

	/** A new reference code. Protected, so a test can force a collision. */
	protected newCode(): string {
		return newReferenceCode();
	}

	/**
	 * Inserts the project's first link with a new reference code. A code
	 * the studio already uses is drawn again, each try in its own savepoint,
	 * up to REFERENCE_TRIES times; then the unique violation surfaces.
	 */
	private async insertWithCode(
		tenant: TenantRef,
		project: ProjectRef,
		fresh: Fresh,
	): Promise<DepositLink> {
		for (let attempt = 1; ; attempt++) {
			try {
				return await withTransaction(() =>
					DepositLink.create({
						tenantId: tenant.id,
						projectId: project.id,
						referenceCode: this.newCode(),
						...fresh,
					}),
				);
			} catch (error) {
				if (
					attempt >= REFERENCE_TRIES ||
					!isUniqueViolation(error, CODE_TAKEN)
				) {
					throw error;
				}
			}
		}
	}
}
