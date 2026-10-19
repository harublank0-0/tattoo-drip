import { BaseTransformer } from "@adonisjs/core/transformers";
import type Tenant from "#modules/tenancy/models/tenant";

/**
 * A tenant as the public API shows it (openapi.yaml, Studio): only what the
 * studio page may show. TAT-32 sends the current slug (also for a request
 * made under an old one) and the name; TAT-44 adds the profile.
 */
export default class PublicStudioTransformer extends BaseTransformer<Tenant> {
	toObject() {
		return this.pick(this.resource, ["slug", "name"]);
	}
}
