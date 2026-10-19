import { BaseTransformer } from "@adonisjs/core/transformers";
import type Inquiry from "#modules/inquiries/models/inquiry";

/**
 * What the public API says about an inquiry it just took (InquiryReceipt):
 * its id and nothing else, never what was sent, the client or the images.
 */
export default class InquiryReceiptTransformer extends BaseTransformer<Inquiry> {
	toObject() {
		return this.pick(this.resource, ["id"]);
	}
}
