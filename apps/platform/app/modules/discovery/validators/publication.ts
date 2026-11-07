import vine, { SimpleMessagesProvider } from "@vinejs/vine";

/**
 * Studio OS's Discover forms (Discover D04,
 * docs/discover/publication-controls.md). Only these fields are read: the
 * listing, consent and takedown columns are set by the service alone, never
 * from a request body.
 */

/** The city Discover lists the business under; empty clears it. */
export const discoverPlaceValidator = vine.create({
	placeId: vine.string().uuid().nullable(),
});

/** Turning the listing on: the consent box, and the version the page showed. */
export const enableListingValidator = vine.create({
	consent: vine.accepted(),
	consentVersion: vine.string().trim().maxLength(64),
});

/** One artist's own Discover switch. */
export const artistDiscoverValidator = vine.create({
	listed: vine.boolean(),
});

discoverPlaceValidator.messagesProvider = new SimpleMessagesProvider({
	"placeId.uuid": "Choose a city from the list.",
	"placeId.string": "Choose a city from the list.",
});
enableListingValidator.messagesProvider = new SimpleMessagesProvider({
	"consent.accepted": "Tick the box to accept the listing terms.",
	"consent.required": "Tick the box to accept the listing terms.",
	"consentVersion.required":
		"The listing terms are missing from this request. Reload the page and try again.",
	"consentVersion.string":
		"The listing terms are missing from this request. Reload the page and try again.",
	"consentVersion.maxLength":
		"The listing terms are missing from this request. Reload the page and try again.",
});
artistDiscoverValidator.messagesProvider = new SimpleMessagesProvider({
	"listed.boolean": "Choose on or off.",
	"listed.required": "Choose on or off.",
});
