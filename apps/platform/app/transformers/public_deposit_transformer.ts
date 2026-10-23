import { BaseTransformer } from "@adonisjs/core/transformers";
import type { DepositPage } from "#modules/payments/services/deposit_page_service";
import { formatDay, formatMoney, validUntil } from "#modules/projects/quotes";

/**
 * The public deposit page (openapi.yaml, DepositPage; TAT-65): what the
 * client's page shows, never notes, the client, the quote history, the
 * price or the proof image; of the sessions, only the next one's start and
 * artist, once paid (TAT-110). Amounts in paisa with their text
 * (formatMoney writes NPR, the only currency so far); `payBy` is the
 * current quote's last valid day in the studio's timezone.
 */
export default class PublicDepositTransformer extends BaseTransformer<DepositPage> {
	toObject() {
		const page = this.resource;
		const payBy = validUntil(page.quote.expiresAt, page.timezone);
		const startsAt = page.nextSession?.startsAt.toUTC().toISO() ?? null;
		return {
			studio: { name: page.studioName },
			project: { brief: page.brief, artistName: page.artistName },
			deposit: {
				amount: page.quote.depositAmount,
				amountText: formatMoney(page.quote.depositAmount),
				due: page.due,
				dueText: formatMoney(page.due),
				currency: page.quote.currency,
				payBy,
				payByText: formatDay(payBy),
			},
			referenceCode: page.referenceCode,
			state: page.state,
			lastProofRejected: page.lastProofRejected,
			proofSubmittedAt: page.proofSubmittedAt?.toUTC().toISO() ?? null,
			paymentMethods: page.methods.map((method) => ({
				kind: method.kind,
				label: method.label,
				qrImageUrl: method.qrImageUrl,
				accountName: method.accountName,
				accountNumber: method.accountNumber,
				bankName: method.bankName,
			})),
			depositPolicy: page.depositPolicy,
			nextSession:
				page.nextSession && startsAt
					? { startsAt, artistName: page.nextSession.artistName }
					: null,
		};
	}
}
