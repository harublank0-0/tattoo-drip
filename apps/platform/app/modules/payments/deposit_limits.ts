import { clientAddress, digest } from "#services/rate_limits";

/**
 * The deposit page's rate limits (TAT-65), per client address and per link
 * token, reads and proof uploads counted apart. Fixed windows, like
 * AUTH_LIMITS. Generous per address because many customers share one
 * carrier-NAT address. TAT-38 may move the per-address part ahead of the
 * tenant lookup; the per-token part stays here.
 */
export const DEPOSIT_LIMITS = {
	read: {
		perAddress: { requests: 120, duration: "10 mins" },
		perToken: { requests: 60, duration: "10 mins" },
	},
	submit: {
		perAddress: { requests: 20, duration: "1 hour" },
		perToken: { requests: 10, duration: "1 hour" },
	},
} as const;

export type DepositAction = keyof typeof DEPOSIT_LIMITS;

/**
 * The limiter keys of one request: digests (HMAC with APP_KEY), so
 * `rate_limits` holds neither the address nor the token.
 */
export function depositLimitKeys(
	action: DepositAction,
	ip: string,
	token: string,
) {
	return {
		perAddress: `deposit_${action}_ip_${digest(clientAddress(ip))}`,
		perToken: `deposit_${action}_token_${digest(token)}`,
	};
}
