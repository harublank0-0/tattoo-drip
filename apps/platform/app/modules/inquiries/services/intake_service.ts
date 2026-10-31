import { inject } from "@adonisjs/core";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { studioTakesInquiries } from "#modules/artists/accepting";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
import { isClaimed } from "#modules/flash/claims";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import FlashService from "#modules/flash/services/flash_service";
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
	/** A flash design from the public list (TAT-129): the inquiry then asks for it and its artist. */
	flashDesignId?: string | null;
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
 * `studio_not_accepting`, `too_many_open_inquiries`, `flash_unavailable`,
 * `flash_claimed`) or
 * InvalidReferenceImageError, thrown after the savepoint rolled back.
 *
 * A request for a flash design (TAT-129) names the design's artist itself
 * and is judged by the artist's flash switch, not by their books.
 */
@inject()
export default class IntakeService {
	constructor(
		private artists: ArtistService,
		private clients: ClientService,
		private images: ImageService,
		private flash: FlashService,
	) {}

	async submit(tenant: TenantRef, submission: Submission): Promise<Inquiry> {
		return withTransaction(async (trx) => {
			const { artistId, flashDesignId } = await this.target(tenant, submission);
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
			// `target` looked the design up without a lock, to refuse early. An
			// owner may have removed it, or the artist been hidden or deleted,
			// while the pictures were processed: hold the artist and the design
			// now, so a removal or an artist's change waits for this request, and
			// anything already gone is the same refusal, not a database error.
			// Held this late, after the slow work, an owner's profile save waits
			// only for the insert below, never for an upload.
			if (flashDesignId !== null) {
				const held =
					artistId !== null &&
					(await this.flash.holdShown(trx, tenant, artistId, flashDesignId));
				if (!held) throw new InquiryRuleError("flash_unavailable");
				// Again on the row just locked: a claim that committed since `target`
				// read the design is the same refusal (holdShown waits for a claim in
				// flight and reads the row it left).
				if (isClaimed(held)) throw new InquiryRuleError("flash_claimed");
			}

			const inquiry = await Inquiry.create(
				{
					tenantId: tenant.id,
					clientId: client.id,
					idea: submission.idea,
					placement: submission.placement,
					approximateSize: submission.approximateSize,
					preferredDates: submission.preferredDates,
					preferredArtistId: artistId,
					flashDesignId,
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
	 * Who and what the inquiry asks for. With a `flashDesignId`: the design
	 * must be shown and its artist visible ("flash_unavailable" otherwise,
	 * the same for unknown, hidden, a hidden or deleted artist's and another
	 * studio's) and not claimed ("flash_claimed"), a `preferredArtistId` other than the design's artist is
	 * "artist_unavailable", and an artist who takes no flash requests is
	 * "artist_not_accepting", whatever their books say; the inquiry then
	 * names the design's artist. Without one, a chosen artist must be one of
	 * the studio's visible artists ("artist_unavailable" otherwise, the same
	 * for unknown, hidden, deleted and another studio's) and accept inquiries
	 * ("artist_not_accepting"). With none chosen, a studio whose visible
	 * artists are all closed takes none ("studio_not_accepting"); one with no
	 * visible artists takes general inquiries. Artists are compared in
	 * memory, so no artist id reaches a query.
	 */
	private async target(
		tenant: TenantRef,
		submission: Submission,
	): Promise<{ artistId: string | null; flashDesignId: string | null }> {
		const visible = await this.artists.listVisible(tenant);
		const artistId = submission.preferredArtistId ?? null;
		const designId = submission.flashDesignId ?? null;
		if (designId !== null) {
			const design = await this.flash.findShown(
				tenant,
				designId,
				visible.map(({ id }) => id),
			);
			const owner = visible.find(({ id }) => id === design?.artistId);
			if (!design || !owner) throw new InquiryRuleError("flash_unavailable");
			// One of a kind and taken: refused whether the studio shows it or hides it.
			if (isClaimed(design)) throw new InquiryRuleError("flash_claimed");
			if (artistId !== null && artistId !== owner.id) {
				throw new InquiryRuleError("artist_unavailable");
			}
			if (!owner.acceptingFlash) {
				throw new InquiryRuleError("artist_not_accepting");
			}
			return { artistId: owner.id, flashDesignId: design.id };
		}
		if (artistId !== null) {
			const artist = visible.find(({ id }) => id === artistId);
			if (!artist) throw new InquiryRuleError("artist_unavailable");
			if (!artist.acceptingInquiries) {
				throw new InquiryRuleError("artist_not_accepting");
			}
			return { artistId, flashDesignId: null };
		}
		if (!studioTakesInquiries(visible)) {
			throw new InquiryRuleError("studio_not_accepting");
		}
		return { artistId: null, flashDesignId: null };
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
