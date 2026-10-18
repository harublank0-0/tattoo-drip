import limiter from "@adonisjs/limiter/services/main";
import { clientAddress, digest } from "#services/rate_limits";

/**
 * The intake's rate limits (TAT-55), each per studio, in fixed windows like
 * AUTH_LIMITS. Every attempt that reaches a count counts, later refusals
 * included. The address is counted first, before Cloudflare is asked (20:
 * many customers share one carrier-NAT address); the studio only after a
 * passed challenge, so nobody can close a studio's form without solving
 * challenges (60: above any pilot studio's busiest hour); the phone after
 * validation, as E.164, before IntakeService.submit (10 a day: the 3-open
 * cap already answers a real person's 4th). TAT-38's generic limits come on
 * top.
 */
export const INTAKE_LIMITS = {
	perAddress: { requests: 20, duration: "1 hour" },
	perTenant: { requests: 60, duration: "1 hour" },
	perPhone: { requests: 10, duration: "24 hours" },
} as const;

export type IntakeLimit = keyof typeof INTAKE_LIMITS;

/**
 * The address and studio keys of one request. The address is a digest
 * (HMAC with APP_KEY) together with the tenant id, so `rate_limits` holds no
 * address and one studio's counts never touch another's.
 */
export function intakeLimitKeys(tenantId: string, ip: string) {
	return {
		perAddress: `inquiry_ip_${digest(`${tenantId}:${clientAddress(ip)}`)}`,
		perTenant: `inquiry_tenant_${tenantId}`,
	};
}

/** The key of one E.164 phone in one studio: a digest, no number in it. */
export function intakePhoneKey(tenantId: string, phone: string) {
	return `inquiry_phone_${digest(`${tenantId}:${phone}`)}`;
}

/**
 * Counts one attempt. Over the limit it throws E_TOO_MANY_REQUESTS, which
 * the API answers as 429 `rate_limited` with Retry-After. The count lives on
 * the limiter's own connection, so it survives the request's rollback.
 */
export async function countIntake(
	limit: IntakeLimit,
	key: string,
): Promise<void> {
	// use() parses the durations in the object it gets, so give it a copy.
	await limiter.use({ ...INTAKE_LIMITS[limit] }).consume(key);
}
