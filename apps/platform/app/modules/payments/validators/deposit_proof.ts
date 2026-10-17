import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import type { Infer } from "@vinejs/vine/types";
import { IMAGE_FORMAT_MESSAGE } from "#modules/media/errors";
import { imageFile } from "#modules/media/validators/image_file";
import { DEPOSIT_METHOD_KINDS } from "#modules/payments/deposit_page";

export const PROOF_MESSAGE = "Attach a screenshot of your payment.";
export const METHOD_MESSAGE = "Choose how you paid.";
export const AMOUNT_MESSAGE = "Reload the page and try again.";

/**
 * A deposit proof from the public deposit page (TAT-65), as the multipart
 * body gives it: the first `proof` file (the controller passes
 * `request.file("proof")`), `method` and `expectedAmount` (the `due` the
 * page showed, in paisa). The image is only filtered here (size,
 * extension): ImageService checks what it really is. Whether the studio
 * shows that method, and whether the amount is still what is due, is
 * DepositPageService's job. Any other field is dropped.
 */
export const depositProofValidator = vine.create({
	proof: imageFile(),
	method: vine.enum(DEPOSIT_METHOD_KINDS),
	expectedAmount: vine.number().withoutDecimals().range([1, 1_000_000_000]),
});

export type DepositProofInput = Infer<typeof depositProofValidator>;

depositProofValidator.messagesProvider = new SimpleMessagesProvider({
	"proof.required": PROOF_MESSAGE,
	"proof.file": PROOF_MESSAGE,
	"proof.file.size": "Use an image of 10 MB or less.",
	"proof.file.extname": IMAGE_FORMAT_MESSAGE,
	"method.required": METHOD_MESSAGE,
	"method.enum": METHOD_MESSAGE,
	"expectedAmount.required": AMOUNT_MESSAGE,
	"expectedAmount.number": AMOUNT_MESSAGE,
	"expectedAmount.withoutDecimals": AMOUNT_MESSAGE,
	"expectedAmount.range": AMOUNT_MESSAGE,
});
