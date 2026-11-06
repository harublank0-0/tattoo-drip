import { BaseTransformer } from "@adonisjs/core/transformers";
import type Inquiry from "#modules/inquiries/models/inquiry";

/**
 * What the public API says about an inquiry it just took (InquiryReceipt):
 * its id and its reference, the code the client quotes, and nothing else:
 * never what was sent, the client or the images.
 */
export default class InquiryReceiptTransformer extends BaseTransformer<Inquiry> {
	toObject() {
		const { id, referenceCode } = this.resource;
		// IntakeService gives every new inquiry a code; only older rows lack one.
		if (referenceCode === null) {
			throw new Error(`Inquiry ${id} has no reference code`);
		}
		return { id, reference: referenceCode };
	}
}
