import { clientAddress, digest } from "#services/rate_limits";

/**
 * The review page's rate limits (Reviews and Fresh ink), per client address
 * and per link token, the deposit page's model (TAT-65): reads, writes (the
 * submit and the deletes) and uploads (photos, and a video's sign, upload
 * and finish) counted apart. Fixed windows. Generous per address, because
 * many clients share one carrier-NAT address; the token's limits bound one
 * link. Every request that reaches the count counts, refusals included, and
 * a guess with no token or a malformed one still counts against its address.
 */
export const REVIEW_LIMITS = {
	read: {
		perAddress: { requests: 120, duration: "10 mins" },
		perToken: { requests: 60, duration: "10 mins" },
	},
	write: {
		perAddress: { requests: 30, duration: "1 hour" },
		perToken: { requests: 20, duration: "1 hour" },
	},
	upload: {
		perAddress: { requests: 60, duration: "1 hour" },
		perToken: { requests: 40, duration: "1 hour" },
	},
} as const;

export type ReviewAction = keyof typeof REVIEW_LIMITS;

/** The limiter keys of one request: digests, so `rate_limits` holds neither the address nor the token. */
export function reviewLimitKeys(
	action: ReviewAction,
	ip: string,
	token: string,
) {
	return {
		perAddress: `review_${action}_ip_${digest(clientAddress(ip))}`,
		perToken: `review_${action}_token_${digest(token)}`,
	};
}
