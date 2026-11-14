import { GatewayAccountSchema } from "#database/schema";

export type GatewayAccountStatus = "pending" | "verified" | "suspended";

/**
 * A studio's own PayBridgeNP project (docs/payments-paybridgenp.md). Its
 * secret key and webhook secret are sealed (#services/secret_box): never
 * serialize this model to a page or a log.
 */
export default class GatewayAccount extends GatewayAccountSchema {
	declare status: GatewayAccountStatus;

	/** Never the sealed secrets, even sealed. */
	serialize(...args: Parameters<GatewayAccountSchema["serialize"]>) {
		const {
			secretKeySealed: _key,
			webhookSecretSealed: _secret,
			webhookKey: _path,
			...rest
		} = super.serialize(...args);
		return rest;
	}
}
