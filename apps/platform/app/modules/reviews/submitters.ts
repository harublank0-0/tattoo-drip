import { createHmac, hkdfSync } from "node:crypto";
import { clientAddress } from "#services/rate_limits";
import env from "#start/env";

/**
 * Who submitted a review or post, for disputes only (finding 12): a keyed
 * hash of the submitter's network address (clientAddress: IPv4, or the IPv6
 * /64) and user agent, never either itself. The key is HKDF of APP_KEY with
 * a label of its own, like the review token's. Kept on the row with the time
 * (`submitter_digest`, `submitter_recorded_at`) for SUBMITTER_KEEP_DAYS, then
 * cleared by ClearSubmittersJob. Never in an API answer; operators read it
 * in the database, to tell whether two submissions came from one device.
 */
export const SUBMITTER_KEEP_DAYS = 90;

function submitterKey(): Buffer {
	return Buffer.from(
		hkdfSync(
			"sha256",
			env.get("APP_KEY").release(),
			"",
			"tattoo-drip review-submitter key v1",
			32,
		),
	);
}

/** The digest of one submission's address and user agent: 64 hex characters. */
export function submitterDigest(
	ip: string,
	userAgent: string | undefined,
): string {
	return createHmac("sha256", submitterKey())
		.update(`${clientAddress(ip)}\n${(userAgent ?? "").slice(0, 512)}`)
		.digest("hex");
}
