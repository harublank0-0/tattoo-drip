import vine, { SimpleMessagesProvider } from "@vinejs/vine";

/**
 * The studio's four Good to know texts (TAT-128), plain text. The field
 * names are the form's: `walkIns`, `ageRule`, `beforeSession` and
 * `aftercare` (the controller maps them to the tenant's columns). An empty
 * box arrives as null and clears the text.
 */
export const updateGoodToKnowValidator = vine.create({
	walkIns: vine.string().trim().maxLength(300).nullable(),
	ageRule: vine.string().trim().maxLength(200).nullable(),
	beforeSession: vine.string().trim().maxLength(2000).nullable(),
	aftercare: vine.string().trim().maxLength(2000).nullable(),
});

// The limits are the form's (maxLength on each box), so only a hand-made request
// or a pasted text reaches this message: say it plainly, without the field name.
updateGoodToKnowValidator.messagesProvider = new SimpleMessagesProvider({
	"walkIns.maxLength": "Keep it to 300 characters or fewer.",
	"ageRule.maxLength": "Keep it to 200 characters or fewer.",
	"beforeSession.maxLength": "Keep it to 2000 characters or fewer.",
	"aftercare.maxLength": "Keep it to 2000 characters or fewer.",
});
