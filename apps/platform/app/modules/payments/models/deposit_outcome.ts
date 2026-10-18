import { DepositOutcomeSchema } from "#database/schema";

export const DEPOSIT_OUTCOMES = ["kept", "moved", "refunded"] as const;
export type DepositOutcomeKind = (typeof DEPOSIT_OUTCOMES)[number];

/**
 * What happened to a deposit (TAT-66): kept, moved to a new date (TAT-85:
 * with the missed or cancelled session) or refunded (with the refund
 * payment). `amount` is the deposit money held when it was recorded. One per
 * project close (`sessionId` null) and one per session. Append-only by
 * convention: PaymentService only inserts. Not soft-deleted.
 */
export default class DepositOutcome extends DepositOutcomeSchema {
	declare outcome: DepositOutcomeKind;
}
