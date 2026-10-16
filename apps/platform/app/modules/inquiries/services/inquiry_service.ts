import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import type Tenant from "#modules/tenancy/models/tenant";

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
export default class InquiryService {
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
}
