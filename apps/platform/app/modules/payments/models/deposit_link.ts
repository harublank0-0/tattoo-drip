import { DepositLinkSchema } from "#database/schema";

/**
 * A project's deposit link (TAT-65): the bearer link to its public deposit
 * page. The token is never stored: `tokenNonce` derives it (tokenFor in
 * #modules/payments/deposit_links) and `tokenHash` is what a request is
 * looked up by. One per project, replaced in place by a new link; the
 * reference code stays. Read and change links through DepositLinkService.
 */
export default class DepositLink extends DepositLinkSchema {}
