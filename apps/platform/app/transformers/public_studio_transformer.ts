import { BaseTransformer } from "@adonisjs/core/transformers";
import type { StudioPage } from "#modules/storefront/services/studio_page_service";
import { socialLinks } from "#modules/storefront/studio_page";

/**
 * A studio as the public API shows it (openapi.yaml, Studio; TAT-44): the
 * profile its owners were told the studio page shows, the current slug
 * (also for a request made under an old one), the type and whether it
 * takes inquiries, plus its cover photo (TAT-116), its page look
 * (`storefront`, TAT-56: checked values only), and its opening hours, closed
 * days and Good to know texts (TAT-128). Every field is written out here: a
 * new one needs the contract, a ruling and the exact-fields test.
 * The deposit policy is shown (in Good to know, as the spec decided); never
 * the default deposit percentage, the tenant id, payment methods or members
 * (the cover's and logo's key and size columns stay on the row), nor a closed
 * day's id or an ended one.
 */
export default class PublicStudioTransformer extends BaseTransformer<StudioPage> {
	toObject() {
		const {
			profile,
			acceptingInquiries,
			cover,
			storefront,
			openingHours,
			closedDays,
			goodToKnow,
		} = this.resource;
		const { look, logo } = storefront;
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
			// Always without a description: the name over it says what the page
			// is (openapi.yaml, Studio.cover).
			cover: cover
				? {
						url: cover.url,
						width: cover.width,
						height: cover.height,
						alt: null,
						variants: cover.variants.map(({ url, width }) => ({ url, width })),
					}
				: null,
			storefront: {
				theme: look.theme,
				branding: {
					// Always without a description: the logo sits beside the name.
					logo: logo
						? {
								url: logo.url,
								width: logo.width,
								height: logo.height,
								alt: null,
								variants: logo.variants.map(({ url, width }) => ({
									url,
									width,
								})),
							}
						: null,
					colors: { accent: look.accent, accentDark: look.accentDark },
					font: look.font,
				},
				sections: look.sections.map((type) => ({ type })),
			},
			openingHours: openingHours.map(({ day, opens, closes }) => ({
				day,
				opens,
				closes,
			})),
			closedDays: closedDays.map(({ from, to, note }) => ({ from, to, note })),
			goodToKnow: {
				walkIns: text(goodToKnow.walkIns),
				ageRule: text(goodToKnow.ageRule),
				depositPolicy: text(goodToKnow.depositPolicy),
				beforeSession: text(goodToKnow.beforeSession),
				aftercare: text(goodToKnow.aftercare),
			},
		};
	}
}

/** A studio's text trimmed; a blank one is null (the API's "not set"). */
function text(value: string | null): string | null {
	return value?.trim() || null;
}
