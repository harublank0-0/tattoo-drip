import { clientAddress, digest } from "#services/rate_limits";

/**
 * The review page's rate limits (Reviews and Fresh ink), per client address
 * and per link token, the deposit page's model (TAT-65): reads, writes (the
 * submit, the deletes, the order, a removal and a video's sign) and uploads
 * (photos, and a video's upload and finish) counted apart. Fixed windows. Generous per address, because
 * many clients share one carrier-NAT address; the token's limits bound one
 * link. Every request that reaches the count counts, refusals included, and
 * a guess with no token or a malformed one still counts against its address.
 */
export const REVIEW_LIMITS = {
	// One open page reads itself at most about 35 times in its 15 minutes of
	// polling a processing video (5 s, then 10 s, 20 s and 60 s apart, then
	// it stops), plus a read per tab focus: far below the token's 120.
	read: {
		perAddress: { requests: 300, duration: "10 mins" },
		perToken: { requests: 120, duration: "10 mins" },
	},
	// Saves, deletes, the order, removals and video signs. With uploads
	// below, 50 an hour per address: always under the API gate's 60 writes
	// per caller an hour (callerWrites), so a review page can't use up a
	// shared address's inquiry or deposit writes (review_limits.spec.ts).
	write: {
		perAddress: { requests: 20, duration: "1 hour" },
		perToken: { requests: 20, duration: "1 hour" },
	},
	// Photos, a video's local PUT and its finish: 8 items and a few retries.
	upload: {
		perAddress: { requests: 30, duration: "1 hour" },
		perToken: { requests: 30, duration: "1 hour" },
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
