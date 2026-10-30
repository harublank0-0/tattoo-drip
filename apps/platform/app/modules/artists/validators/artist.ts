import vine, {
	SimpleErrorReporter,
	SimpleMessagesProvider,
} from "@vinejs/vine";
import type { FieldContext } from "@vinejs/vine/types";
import { MAX_ARTIST_STYLES, STYLE_SLUGS } from "#modules/artists/styles";
import { imageFile } from "#modules/media/validators/image_file";
import { httpsUrl } from "#modules/tenancy/validators/tenant";

/**
 * An artist's slug ends a public link, so it follows the tenant slug rules
 * (lowercase letters, digits and hyphens, none at either end) but may be as
 * short as 2 characters: it is a path segment, not a subdomain.
 */
export const ARTIST_SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

/**
 * The input's shape only. Unchecked checkboxes are not sent, so the
 * controller reads a missing boolean as false and a missing `styles` as none.
 */
const fields = () => ({
	name: vine.string().trim().minLength(1).maxLength(120),
	slug: vine.string().trim().toLowerCase().regex(ARTIST_SLUG),
	bio: vine.string().trim().maxLength(1000).nullable().optional(),
	visible: vine.boolean().optional(),
	acceptingInquiries: vine.boolean().optional(),
	closedMessage: vine.string().trim().maxLength(300).nullable().optional(),
	linkToMe: vine.boolean().optional(),
	styles: vine
		.array(vine.enum(STYLE_SLUGS))
		.distinct()
		.maxLength(MAX_ARTIST_STYLES)
		.optional(),
	instagramUrl: httpsUrl().nullable().optional(),
	facebookUrl: httpsUrl().nullable().optional(),
	tiktokUrl: httpsUrl().nullable().optional(),
	photo: imageFile().optional(),
});

export const createArtistValidator = vine.create(fields());

export const updateArtistValidator = vine.create({
	...fields(),
	removePhoto: vine.boolean().optional(),
});

const messages = new SimpleMessagesProvider(
	{
		"slug.regex":
			"Use 2 to 63 lowercase letters, numbers and hyphens, not starting or ending with a hyphen.",
		"styles.array.maxLength": `Pick up to ${MAX_ARTIST_STYLES} styles.`,
		"styles.*.enum": "Pick styles from the list.",
		url: "Enter a full link that starts with https://",
	},
	{
		closedMessage: "message",
		linkToMe: "profile link",
		styles: "styles",
		instagramUrl: "Instagram link",
		facebookUrl: "Facebook link",
		tiktokUrl: "TikTok link",
	},
);

/**
 * VineJS reports a bad style under its position ("styles.0"). The form has
 * one Styles fieldset, so every style error is shown under "styles". The
 * artist form and a work photo's form (TAT-126) both use it.
 * It relies on SimpleErrorReporter pushing one entry per `report` call; the
 * unknown-style test in artist_form.spec.ts guards that.
 */
export class StylesErrorReporter extends SimpleErrorReporter {
	override report(
		message: string,
		rule: string,
		field: FieldContext,
		meta?: Record<string, unknown>,
	) {
		super.report(message, rule, field, meta);
		const error = this.errors[this.errors.length - 1];
		error.field = error.field.replace(/^styles\.\d+$/, "styles");
	}
}

for (const validator of [createArtistValidator, updateArtistValidator]) {
	validator.messagesProvider = messages;
	validator.errorReporter = () => new StylesErrorReporter();
}
