import { inject } from "@adonisjs/core";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { DateTime } from "luxon";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import { InquiryRuleError } from "#modules/inquiries/errors";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import type TattooProject from "#modules/projects/models/tattoo_project";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";

type TenantRef = Pick<Tenant, "id">;

/** Inquiries per page in the inbox. */
export const INQUIRIES_PER_PAGE = 25;

export type InquiryPage = {
	inquiries: Inquiry[];
	total: number;
	lastPage: number;
};

/**
 * The way to read a tenant's inquiries and decide them (TAT-46): the inbox.
 * Every call is scoped to the tenant; the inbox routes are owners only.
 * An inquiry is a frozen record: only its decision ever changes here.
 */
@inject()
export default class InquiryService {
	constructor(
		private artists: ArtistService,
		private projects: ProjectService,
	) {}

	/** Live `new` inquiries, oldest first: whoever has waited longest. */
	async listNew(tenant: TenantRef, page: number): Promise<InquiryPage> {
		const result = await Inquiry.query()
			.where("tenant_id", tenant.id)
			.where("status", "new")
			.orderBy("created_at", "asc")
			.orderBy("id", "asc")
			.paginate(page, INQUIRIES_PER_PAGE);
		return {
			inquiries: result.all(),
			total: result.total,
			lastPage: result.lastPage,
		};
	}

	/** Live accepted and declined inquiries, the latest decision first. */
	async listDecided(tenant: TenantRef, page: number): Promise<InquiryPage> {
		const result = await Inquiry.query()
			.where("tenant_id", tenant.id)
			.whereIn("status", ["accepted", "declined"])
			.orderBy("decided_at", "desc")
			.orderBy("id", "desc")
			.paginate(page, INQUIRIES_PER_PAGE);
		return {
			inquiries: result.all(),
			total: result.total,
			lastPage: result.lastPage,
		};
	}

	/** How many live inquiries wait for a decision (the nav badge). */
	async countNew(tenant: TenantRef): Promise<number> {
		const [row] = await Inquiry.query()
			.where("tenant_id", tenant.id)
			.where("status", "new")
			.count("* as total");
		return Number(row.$extras.total);
	}

	/** The tenant's live inquiry with this id, else E_ROW_NOT_FOUND (a 404). */
	async findFor(tenant: TenantRef, id: string): Promise<Inquiry> {
		return Inquiry.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.firstOrFail();
	}

	/** The tenant's live inquiry with this id, or null. */
	async find(tenant: TenantRef, id: string): Promise<Inquiry | null> {
		return Inquiry.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.first();
	}

	/**
	 * The live reference images of an inquiry, or of the project an accepted
	 * inquiry became, by position. Load the inquiry or project scoped to the
	 * tenant (and to the member, for a project) first: that is the access
	 * check for these private images.
	 */
	async images(
		tenant: TenantRef,
		of: { inquiryId: string } | { projectId: string },
	): Promise<ReferenceImage[]> {
		const query = ReferenceImage.query().where("tenant_id", tenant.id);
		if ("inquiryId" in of) query.where("inquiry_id", of.inquiryId);
		else query.where("project_id", of.projectId);
		return query.orderBy("position", "asc").orderBy("id", "asc");
	}

	/** How many live reference images each of these inquiries has. */
	async imageCounts(
		tenant: TenantRef,
		inquiryIds: string[],
	): Promise<Map<string, number>> {
		if (inquiryIds.length === 0) return new Map();
		const rows = await ReferenceImage.query()
			.where("tenant_id", tenant.id)
			.whereIn("inquiry_id", inquiryIds)
			.select("inquiry_id")
			.count("* as total")
			.groupBy("inquiry_id");
		return new Map(
			rows.map((row) => [row.inquiryId as string, Number(row.$extras.total)]),
		);
	}

	/** The client's live inquiries, newest first (the client profile). */
	async forClient(tenant: TenantRef, clientId: string): Promise<Inquiry[]> {
		return Inquiry.query()
			.where("tenant_id", tenant.id)
			.where("client_id", clientId)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc");
	}

	/** When each of these clients last sent an inquiry. */
	async latestForClients(
		tenant: TenantRef,
		clientIds: string[],
	): Promise<Map<string, DateTime>> {
		if (clientIds.length === 0) return new Map();
		const rows = await Inquiry.query()
			.where("tenant_id", tenant.id)
			.whereIn("client_id", clientIds)
			.select("client_id")
			.max("created_at as latest")
			.groupBy("client_id");
		return new Map(
			rows.map((row) => [row.clientId, toDateTime(row.$extras.latest)]),
		);
	}

	/**
	 * The live reference images on any of these inquiries or projects, each
	 * once (an accepted inquiry's images carry both ids), by inquiry, then
	 * project, then position. Load the client scoped to the tenant first:
	 * that is the access check for these private images.
	 */
	async imagesFor(
		tenant: TenantRef,
		{ inquiryIds, projectIds }: { inquiryIds: string[]; projectIds: string[] },
	): Promise<ReferenceImage[]> {
		if (inquiryIds.length === 0 && projectIds.length === 0) return [];
		return ReferenceImage.query()
			.where("tenant_id", tenant.id)
			.where((group) => {
				if (inquiryIds.length > 0) group.whereIn("inquiry_id", inquiryIds);
				if (projectIds.length > 0) group.orWhereIn("project_id", projectIds);
			})
			.orderBy("inquiry_id", "asc")
			.orderBy("project_id", "asc")
			.orderBy("position", "asc")
			.orderBy("id", "asc");
	}

	/**
	 * Accepts a new inquiry: a `reviewing` project for its client, with the
	 * idea as the brief and `artistId` (or none) as the artist; the
	 * inquiry's live reference images move to the project (they keep their
	 * inquiry); the inquiry is decided. One transaction under the inquiry's
	 * row lock, so two owners deciding at once serialize and the second gets
	 * InquiryRuleError "already_decided". A non-null artist must be a live
	 * artist of the tenant ("artist_unavailable"). Returns the project.
	 */
	async accept(
		tenant: TenantRef,
		inquiry: Inquiry,
		artistId: string | null,
	): Promise<TattooProject> {
		assertInquiryOf(tenant, inquiry);
		return withTransaction(async (trx) => {
			const live = await lockInquiry(trx, tenant, inquiry.id);
			if (live.status !== "new") throw new InquiryRuleError("already_decided");
			if (artistId !== null) await this.checkArtist(tenant, artistId);

			const project = await this.projects.createFromInquiry(tenant, {
				clientId: live.clientId,
				inquiryId: live.id,
				brief: live.idea,
				artistId,
			});
			// The soft-delete scope is a fetch hook, which an update query
			// skips: leave deleted images out by hand.
			await ReferenceImage.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("inquiry_id", live.id)
				.whereNull("deleted_at")
				.update({ project_id: project.id });
			await decide(live, "accepted");
			return project;
		});
	}

	/** Declines a new inquiry; final. "already_decided" if it was decided. */
	async decline(tenant: TenantRef, inquiry: Inquiry): Promise<void> {
		assertInquiryOf(tenant, inquiry);
		await withTransaction(async (trx) => {
			const live = await lockInquiry(trx, tenant, inquiry.id);
			if (live.status !== "new") throw new InquiryRuleError("already_decided");
			await decide(live, "declined");
		});
	}

	/** A live artist of the tenant, else "artist_unavailable". */
	private async checkArtist(tenant: TenantRef, artistId: string) {
		try {
			await this.artists.findFor(tenant, artistId);
		} catch (error) {
			if (error instanceof lucidErrors.E_ROW_NOT_FOUND) {
				throw new InquiryRuleError("artist_unavailable");
			}
			throw error;
		}
	}
}

/** Locks the live inquiry row. A deleted or other tenant's inquiry is a 404. */
function lockInquiry(
	trx: TransactionClientContract,
	tenant: TenantRef,
	id: string,
) {
	return Inquiry.query({ client: trx })
		.where("tenant_id", tenant.id)
		.where("id", id)
		.forUpdate()
		.firstOrFail();
}

/**
 * Records the decision. The database wants `decided_at` exactly when the
 * status isn't `new`, so both change in one save.
 */
async function decide(inquiry: Inquiry, status: "accepted" | "declined") {
	inquiry.status = status;
	inquiry.decidedAt = DateTime.now();
	await inquiry.save();
}

/** A caller bug, not a user error: inquiries come from the tenant's reads. */
function assertInquiryOf(tenant: TenantRef, inquiry: Inquiry) {
	if (inquiry.tenantId !== tenant.id) {
		throw new Error(`Inquiry ${inquiry.id} belongs to another tenant`);
	}
}

/** An aggregate's timestamp, as node-pg returns it (a Date), as a DateTime. */
function toDateTime(value: Date | string): DateTime {
	return value instanceof Date
		? DateTime.fromJSDate(value)
		: DateTime.fromISO(value);
}
