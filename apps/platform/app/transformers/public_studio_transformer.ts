import { BaseTransformer } from "@adonisjs/core/transformers";
import type { StudioPage } from "#modules/storefront/services/studio_page_service";
import { socialLinks } from "#modules/storefront/studio_page";

/**
 * A studio as the public API shows it (openapi.yaml, Studio; TAT-44): the
 * profile its owners were told the studio page shows, the current slug
 * (also for a request made under an old one), the type and whether it
 * takes inquiries. Every field is written out here: a new one needs the
 * contract, a ruling and the exact-fields test. Never the tenant id, the
 * deposit settings, payment methods or members.
 */
export default class PublicStudioTransformer extends BaseTransformer<StudioPage> {
	toObject() {
		const { profile, acceptingInquiries } = this.resource;
		return {
			slug: profile.slug,
			name: profile.name,
			type: profile.type,
			intro: profile.intro,
			timezone: profile.timezone,
			contact: {
				phone: profile.contactPhone,
				email: profile.contactEmail,
				address: profile.address,
			},
			socialLinks: socialLinks(profile),
			acceptingInquiries,
		};
	}
}
