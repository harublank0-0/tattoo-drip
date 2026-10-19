import { inject } from "@adonisjs/core";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
import {
	InquiryRuleError,
	InvalidReferenceImageError,
} from "#modules/inquiries/errors";
import NewInquiryAlertJob from "#modules/inquiries/jobs/new_inquiry_alert_job";
import Inquiry, { type SourceChannel } from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import { InvalidImageError } from "#modules/media/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService, {
	type StoredImage,
} from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { afterRollback, withTransaction } from "#services/db_context";
import { dispatchInTransaction } from "#services/queue";

type TenantRef = Pick<Tenant, "id">;
type Upload = Pick<MultipartFile, "tmpPath">;

/**
 * Open inquiries (live, `new`) one phone number may have with a studio
 * (docs/requirements.md, abuse protection).
 */
export const OPEN_INQUIRY_LIMIT = 3;

const PURPOSE = "reference_image";

/** A validated submission: the phone in E.164, empty fields null or left out. */
export type Submission = {
	idea: string;
	placement: string;
	approximateSize: string;
	preferredDates: string;
	preferredArtistId?: string | null;
	budget?: string | null;
	sourceChannel: SourceChannel;
	contactName: string;
	contactPhone: string;
	contactEmail?: string | null;
	referenceImages?: Upload[];
};

/**
 * Turns a submission from the public intake form into a `new` inquiry
 * (TAT-51), all or nothing, in one transaction: the artist rules, the
 * client (matched by phone, never changed), the open-inquiry cap, the
 * images, the inquiry with what was sent, its reference rows, and the staff
 * alert job. Every refusal comes before any image is decoded. Refusals are
 * InquiryRuleError (`artist_unavailable`, `artist_not_accepting`,
 * `studio_not_accepting`, `too_many_open_inquiries`) or
 * InvalidReferenceImageError, thrown after the savepoint rolled back.
 */
@inject()
export default class IntakeService {
	constructor(
		private artists: ArtistService,
		private clients: ClientService,
		private images: ImageService,
	) {}

	async submit(tenant: TenantRef, submission: Submission): Promise<Inquiry> {
		return withTransaction(async (trx) => {
			await this.checkArtist(tenant, submission.preferredArtistId ?? null);
			// Locks the client (or, for a new phone, its index entry) until the
			// transaction ends, so the count below can't be overtaken.
			const client = await this.clients.matchByPhone(tenant, {
				name: submission.contactName,
				phone: submission.contactPhone,
				email: submission.contactEmail ?? null,
			});
			await this.checkOpenLimit(tenant, submission.contactPhone);
			const images = await this.storeImages(
				tenant,
				submission.referenceImages ?? [],
			);

			const inquiry = await Inquiry.create(
				{
					tenantId: tenant.id,
					clientId: client.id,
					idea: submission.idea,
					placement: submission.placement,
					approximateSize: submission.approximateSize,
					preferredDates: submission.preferredDates,
					preferredArtistId: submission.preferredArtistId ?? null,
					budget: submission.budget ?? null,
					sourceChannel: submission.sourceChannel,
					// What was sent, frozen: never the client's stored details.
					contactName: submission.contactName,
					contactPhone: submission.contactPhone,
					contactEmail: submission.contactEmail ?? null,
					status: "new",
				},
				{ client: trx },
			);
			for (const [position, image] of images.entries()) {
				await ReferenceImage.create(
					{
						tenantId: tenant.id,
						inquiryId: inquiry.id,
						imageKey: image.key,
						width: image.width,
						height: image.height,
						position,
					},
					{ client: trx },
				);
			}
			await queueAlert(trx, tenant, inquiry);
			return inquiry;
		});
	}

	/**
	 * A chosen artist must be one of the studio's visible artists
	 * ("artist_unavailable" otherwise, the same for unknown, hidden, deleted
	 * and another studio's) and accept inquiries ("artist_not_accepting").
	 * With none chosen, a studio whose visible artists are all closed takes
	 * none ("studio_not_accepting"); one with no visible artists takes
	 * general inquiries. Compared in memory, so no id reaches a query.
	 */
	private async checkArtist(tenant: TenantRef, artistId: string | null) {
		const visible = await this.artists.listVisible(tenant);
		if (artistId !== null) {
			const artist = visible.find(({ id }) => id === artistId);
			if (!artist) throw new InquiryRuleError("artist_unavailable");
			if (!artist.acceptingInquiries) {
				throw new InquiryRuleError("artist_not_accepting");
			}
			return;
		}
		if (visible.length > 0 && visible.every((a) => !a.acceptingInquiries)) {
			throw new InquiryRuleError("studio_not_accepting");
		}
	}

	/**
	 * Refuses the phone's next inquiry once it has OPEN_INQUIRY_LIMIT open
	 * ones: live, `new`, with this frozen `contact_phone` (so a deleted
	 * client's open inquiries count too). Runs under matchByPhone's lock.
	 */
	private async checkOpenLimit(tenant: TenantRef, phone: string) {
		const [row] = await Inquiry.query()
			.where("tenant_id", tenant.id)
			.where("status", "new")
			.where("contact_phone", phone)
			// The soft-delete scope is a fetch hook; say it here too, for the aggregate.
			.whereNull("deleted_at")
			.count("* as total");
		if (Number(row.$extras.total) >= OPEN_INQUIRY_LIMIT) {
			throw new InquiryRuleError("too_many_open_inquiries");
		}
	}

	/**
	 * Stores each upload in order (one at a time, so one inquiry holds one
	 * decode slot) and registers each file's deletion the moment it is
	 * stored: if a later image or anything after it fails, or the commit
	 * does, no file is left behind.
	 */
	private async storeImages(
		tenant: TenantRef,
		uploads: Upload[],
	): Promise<StoredImage[]> {
		const stored: StoredImage[] = [];
		for (const [index, upload] of uploads.entries()) {
			let image: StoredImage;
			try {
				image = await this.images.store(upload, { tenant, purpose: PURPOSE });
			} catch (error) {
				if (error instanceof InvalidImageError) {
					throw new InvalidReferenceImageError(index, error.message, {
						cause: error,
					});
				}
				throw error;
			}
			afterRollback(() => this.images.delete(PURPOSE, image.key));
			stored.push(image);
		}
		return stored;
	}
}

/**
 * The staff alert, queued in the inquiry's transaction so it exists exactly
 * when the inquiry does (TAT-52 sends the alerts from the job).
 */
function queueAlert(
	trx: TransactionClientContract,
	tenant: TenantRef,
	inquiry: Inquiry,
) {
	return dispatchInTransaction(
		NewInquiryAlertJob.dispatch({ tenantId: tenant.id, inquiryId: inquiry.id }),
		trx,
	);
}
