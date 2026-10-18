import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
import {
	InquiryRuleError,
	InvalidReferenceImageError,
} from "#modules/inquiries/errors";
import { HONEYPOT_FIELD, honeypotFilled } from "#modules/inquiries/honeypot";
import { countIntake, intakePhoneKey } from "#modules/inquiries/intake_limits";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import IntakeService from "#modules/inquiries/services/intake_service";
import {
	ARTIST_MESSAGE,
	intakeValidator,
} from "#modules/inquiries/validators/intake";
import { ApiException } from "#services/public_api_errors";
import { discardUploads, receiveUploads } from "#services/uploads";
import InquiryReceiptTransformer from "#transformers/inquiry_receipt_transformer";

/**
 * The public intake (createInquiry in openapi.yaml, TAT-51): one multipart
 * request with the fields and up to 5 reference images. The answer is only
 * the new inquiry's id, whether or not the phone was known. The intakeGuard
 * middleware already counted the address, checked the bot challenge and
 * counted the studio (TAT-55); here come the honeypot, after the body, and
 * the phone count, after validation.
 */
@inject()
export default class PublicInquiriesController {
	constructor(private intake: IntakeService) {}

	async store(ctx: HttpContext) {
		const { request, response } = ctx;
		const { tenant } = publicTenantContext(ctx);
		try {
			if (request.bodyType !== "multipart") {
				throw ApiException.of("unsupported_media_type");
			}
			// The tenant is known (publicTenant ran), so only now does the body
			// go to disk (the body parser reads no multipart body itself:
			// multipart.autoProcess is false).
			await receiveUploads(request);
			// A filled honeypot is refused like a failed challenge (TAT-55),
			// before validation, so no field error names the trap. It is read from
			// the body only: request.input() merges the query string over the body,
			// so a query parameter of that name would fill it, and an empty one
			// would hide a filled field.
			if (honeypotFilled(request.body()[HONEYPOT_FIELD])) {
				throw ApiException.of("challenge_failed");
			}
			const submission = await request.validateUsing(intakeValidator, {
				// request.files() is always a list, also for a single part.
				data: {
					...request.all(),
					referenceImages: request.files("referenceImages"),
				},
			});
			// Every validated try counts against its E.164 phone at this studio
			// (TAT-55), whatever submit answers; the 3-open cap is submit's.
			await countIntake(
				"perPhone",
				intakePhoneKey(tenant.id, submission.contactPhone),
			);
			const inquiry = await this.intake.submit(tenant, submission);
			response.status(201);
			return await ctx.serialize(InquiryReceiptTransformer.transform(inquiry));
		} catch (error) {
			throw toApiError(error);
		} finally {
			await discardUploads(request);
		}
	}
}

/** The intake's refusals as the API answers them; any other error as it is. */
function toApiError(error: unknown) {
	if (error instanceof InvalidReferenceImageError) {
		return ApiException.of("validation_failed", {
			[`referenceImages.${error.index}`]: [error.message],
		});
	}
	if (!(error instanceof InquiryRuleError)) return error;
	switch (error.reason) {
		case "artist_unavailable":
			return ApiException.of("validation_failed", {
				preferredArtistId: [ARTIST_MESSAGE],
			});
		case "artist_not_accepting":
		case "studio_not_accepting":
		case "too_many_open_inquiries":
			return ApiException.of(error.reason);
		default:
			return error;
	}
}
