import { compose } from "@adonisjs/core/helpers";
import { PaymentMethodSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";

export const PAYMENT_METHOD_KINDS = [
	"fonepay",
	"esewa",
	"khalti",
	"bank",
	"cash",
] as const;
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number];

/**
 * A way the studio gets paid. Read and change methods through
 * PaymentMethodService, not from other modules directly.
 */
export default class PaymentMethod extends compose(
	PaymentMethodSchema,
	withSoftDeletes,
) {
	declare kind: PaymentMethodKind;
}
