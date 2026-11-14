import { inject } from "@adonisjs/core";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { DateTime } from "luxon";
import type TattooProject from "#modules/projects/models/tattoo_project";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService, {
	type Member,
} from "#modules/projects/services/project_service";
import { ReviewLinkRuleError } from "#modules/reviews/errors";
import ReviewLink from "#modules/reviews/models/review_link";
import {
	hashReviewToken,
	newReviewNonce,
	REVIEW_LINK_MONTHS,
	reviewPageUrl,
	reviewsEnabled,
	reviewTokenFor,
} from "#modules/reviews/review_links";
import { REVIEWABLE_STATUSES } from "#modules/reviews/rules";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionService from "#modules/scheduling/services/session_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";

type TenantRef = Pick<Tenant, "id">;

/**
 * The link's token while it works, else null: not revoked, not expired,
 * and the row's nonce still derives the stored hash (rotating APP_KEY kills
 * every link, as it does deposit links).
 */
function liveToken(
	link: ReviewLink,
	now: DateTime = DateTime.now(),
): string | null {
	if (link.revokedAt !== null) return null;
	if (link.expiresAt.toMillis() <= now.toMillis()) return null;
	const token = reviewTokenFor(link.tokenNonce);
	return hashReviewToken(token) === link.tokenHash ? token : null;
}

/** What "Ask for a review" gets: the link, its token and URL, and whether this call made it. */
export type IssuedReviewLink = {
	link: ReviewLink;
	token: string;
	url: string;
	created: boolean;
};

/**
 * Review links (Reviews and Fresh ink, rulings 2 to 4): one live link per
 * project, made once the project's tattoo work is done, working for twelve
 * months, revocable. The studio's "Ask for a review" (slice 2) calls
 * `linkFor`; the public API resolves a token with `resolve`.
 */
@inject()
export default class ReviewLinkService {
	constructor(
		private projects: ProjectService,
		private sessions: SessionService,
	) {}

	/**
	 * The project's review link, made if it has none that works (ruling 3:
	 * asking again shows the same link, or a new one once the old was
	 * revoked or expired). `member` must be able to open the project
	 * (ProjectService.findFor: owners, and the artist the project is
	 * assigned to), else E_ROW_NOT_FOUND. Refused with ReviewLinkRuleError
	 * while reviews are off (`disabled`) and until the tattoo work is done
	 * (`not_done`: in progress, healing check or completed, with a completed
	 * tattoo session). Under the project's row lock, so two clicks make one
	 * link; an expired link is retired (revoked) when its successor is made.
	 */
	async linkFor(
		tenant: Pick<Tenant, "id" | "slug">,
		member: Member,
		projectId: string,
	): Promise<IssuedReviewLink> {
		if (!reviewsEnabled()) throw new ReviewLinkRuleError("disabled");
		const project = await this.projects.findFor(tenant, member, projectId);
		return withTransaction(async (trx) => {
			const live = await this.projects.lockLive(trx, tenant, project.id);
			if (!live || !(await this.tattooDone(tenant, live))) {
				throw new ReviewLinkRuleError("not_done");
			}
			const current = await ReviewLink.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("project_id", live.id)
				.whereNull("revoked_at")
				.forUpdate()
				.first();
			const now = DateTime.now();
			if (current) {
				const token = liveToken(current, now);
				if (token) {
					return {
						link: current,
						token,
						url: reviewPageUrl(tenant.slug, token),
						created: false,
					};
				}
				// Expired, or made with an earlier APP_KEY: retire it.
				current.revokedAt = now;
				await current.save();
			}
			const tokenNonce = newReviewNonce();
			const token = reviewTokenFor(tokenNonce);
			const link = await ReviewLink.create(
				{
					tenantId: tenant.id,
					projectId: live.id,
					tokenNonce,
					tokenHash: hashReviewToken(token),
					createdBy: member.userId,
					createdAt: now,
					expiresAt: now.plus({ months: REVIEW_LINK_MONTHS }),
					revokedAt: null,
				},
				{ client: trx },
			);
			return {
				link,
				token,
				url: reviewPageUrl(tenant.slug, token),
				created: true,
			};
		});
	}

	/**
	 * Revokes the project's live link (ruling 4): it stops working at once;
	 * what the client posted stays. True when a link was revoked, false when
	 * there was none. `member` must be able to open the project.
	 */
	async revoke(
		tenant: TenantRef,
		member: Member,
		projectId: string,
	): Promise<boolean> {
		const project = await this.projects.findFor(tenant, member, projectId);
		const changed = await ReviewLink.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.whereNull("revoked_at")
			.update({ revoked_at: new Date() });
		return Number(changed[0] ?? 0) > 0;
	}

	/**
	 * What the project page's "Ask for a review" shows (slice 2): the live
	 * link with its token and URL while it works, else null, and the latest
	 * link made for the project (revoked or expired included) for "the last
	 * link was revoked". The caller loaded the project for the member
	 * (ProjectService.findFor).
	 */
	async stateFor(
		tenant: Pick<Tenant, "id" | "slug">,
		project: Pick<TattooProject, "id">,
	): Promise<{
		live: { link: ReviewLink; token: string; url: string } | null;
		latest: ReviewLink | null;
	}> {
		const latest = await ReviewLink.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc")
			.first();
		const token = latest ? liveToken(latest) : null;
		return {
			live:
				latest && token
					? { link: latest, token, url: reviewPageUrl(tenant.slug, token) }
					: null,
			latest,
		};
	}

	/**
	 * Records that the studio sent the project's live link (a chat link or a
	 * copied message of "Ask for a review", slice 2): `sent_at` now. Nothing
	 * when the project has no live link. `member` must be able to open the
	 * project.
	 */
	async markSent(
		tenant: TenantRef,
		member: Member,
		projectId: string,
	): Promise<void> {
		const project = await this.projects.findFor(tenant, member, projectId);
		await ReviewLink.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.whereNull("revoked_at")
			.where("expires_at", ">", new Date())
			.update({ sent_at: new Date() });
	}

	/**
	 * Revokes every live link of the client's projects (the privacy
	 * deletion, finding 8). In the caller's transaction.
	 */
	async revokeForClient(
		trx: TransactionClientContract,
		tenant: TenantRef,
		clientId: string,
	): Promise<void> {
		const byClient = await this.projects.idsByClient(tenant, [clientId]);
		const ids = byClient.get(clientId) ?? [];
		if (ids.length === 0) return;
		await ReviewLink.query({ client: trx })
			.where("tenant_id", tenant.id)
			.whereIn("project_id", ids)
			.whereNull("revoked_at")
			.update({ revoked_at: new Date() });
	}

	/**
	 * The link of `token` in this tenant while it works, else null: unknown,
	 * revoked, expired, another tenant's and an earlier APP_KEY's are all
	 * null. Looked up by the token's hash, never the token.
	 */
	async resolve(tenant: TenantRef, token: string): Promise<ReviewLink | null> {
		const link = await ReviewLink.query()
			.where("tenant_id", tenant.id)
			.where("token_hash", hashReviewToken(token))
			.first();
		return link && liveToken(link) ? link : null;
	}

	/**
	 * Whether the project's tattoo work is done (ruling 3): its status is in
	 * progress, healing check or completed, and it has a completed tattoo
	 * session. The page's artist and date come from that session too.
	 */
	async tattooDone(
		tenant: TenantRef,
		project: Pick<TattooProject, "id" | "tenantId" | "status">,
	): Promise<boolean> {
		if (!(REVIEWABLE_STATUSES as readonly string[]).includes(project.status)) {
			return false;
		}
		return (await this.sessions.lastCompletedTattoo(tenant, project)) !== null;
	}
}
