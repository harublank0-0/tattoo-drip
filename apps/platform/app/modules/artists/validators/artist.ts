import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import { imageFile } from "#modules/media/validators/image_file";

/**
 * An artist's slug ends a public link, so it follows the tenant slug rules
 * (lowercase letters, digits and hyphens, none at either end) but may be as
 * short as 2 characters: it is a path segment, not a subdomain.
 */
export const ARTIST_SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

/**
 * The input's shape only. Unchecked checkboxes are not sent, so the
 * controller reads a missing boolean as false.
 */
const fields = () => ({
	name: vine.string().trim().minLength(1).maxLength(120),
	slug: vine.string().trim().toLowerCase().regex(ARTIST_SLUG),
	bio: vine.string().trim().maxLength(1000).nullable().optional(),
	visible: vine.boolean().optional(),
	acceptingInquiries: vine.boolean().optional(),
	closedMessage: vine.string().trim().maxLength(300).nullable().optional(),
	linkToMe: vine.boolean().optional(),
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
	},
	{ closedMessage: "message", linkToMe: "profile link" },
);
createArtistValidator.messagesProvider = messages;
updateArtistValidator.messagesProvider = messages;
