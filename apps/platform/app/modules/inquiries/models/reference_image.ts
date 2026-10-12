import { compose } from "@adonisjs/core/helpers";
import { ReferenceImageSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";

/**
 * An image a client sent as a reference, attached to the inquiry and then
 * to its project. Private: its URL comes from
 * `ImageService.url("reference_image", key)`, a short-lived signed URL, only
 * after loading the owning record scoped to the tenant.
 */
export default class ReferenceImage extends compose(
	ReferenceImageSchema,
	withSoftDeletes,
) {}
