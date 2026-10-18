import type { Limiter, LimiterResponse } from "@adonisjs/limiter";
import limiter from "@adonisjs/limiter/services/main";
import { clientAddress, digest } from "#services/rate_limits";

/**
 * The auth rate limits (TAT-8), by name. Each window is fixed: it starts
 * with the first counted attempt, and a lockout ends when it does (no extra
 * block). Password reset (TAT-18) adds its own entries here and a named
 * middleware in start/limiter.ts.
 */
export const AUTH_LIMITS = {
	/** Login attempts from one client address that didn't sign in. */
	loginPerIp: { requests: 10, duration: "15 mins" },
	/**
	 * Failed logins for one email, from any address. More than twice
	 * loginPerIp over the same window, so one address alone can never lock an
	 * account: it fits at most two of its windows into one of these.
	 */
	loginPerEmail: { requests: 25, duration: "15 mins" },
	/** Every signup request from one client address. */
	signup: { requests: 10, duration: "1 hour" },
} as const;

export function loginIpKey(ip: string) {
	return `login_ip_${digest(clientAddress(ip))}`;
}

/** Case and surrounding spaces don't make a separate count. */
export function loginEmailKey(email: string) {
	return `login_email_${digest(email.trim().toLowerCase())}`;
}

/**
 * A refund is skipped when fewer than this many seconds were left in the
 * window the attempt was counted in, because the window may be over by the
 * time the credential check ends.
 */
const REFUND_SLACK_SECONDS = 3;

/**
 * Runs `verify` (the credential check) unless this address or this email is
 * over its login limit. Over the limit, it throws E_TOO_MANY_REQUESTS
 * without checking the password. The address is counted first, so a refused
 * address never adds to the email's count. Both counts are taken before
 * `verify` runs, so parallel guesses can't all pass a check first. A sign-in
 * gives back the two points it took and nothing more: failures already
 * counted for the email stay, since a sign-in proves the password, not who
 * made the earlier guesses (emails are canonical since TAT-18, so there are
 * no look-alike accounts any more). A point is given back only while the
 * window it was taken in is still open, so a slow check can't erase
 * failures of the next window. Any email is counted, registered or not, so
 * a lockout reveals nothing about accounts.
 */
export async function throttleLogin<T>(
	ip: string,
	email: string,
	verify: () => Promise<T>,
) {
	// use() parses the durations in the object it gets, so give it copies.
	const perIp = limiter.use({ ...AUTH_LIMITS.loginPerIp });
	const perEmail = limiter.use({ ...AUTH_LIMITS.loginPerEmail });
	const ipKey = loginIpKey(ip);
	const emailKey = loginEmailKey(email);

	const countedAt = Date.now();
	const ipWindow = await perIp.consume(ipKey);
	const emailWindow = await perEmail.consume(emailKey);
	const result = await verify();
	await Promise.all([
		giveBack(perIp, ipKey, countedAt, ipWindow),
		giveBack(perEmail, emailKey, countedAt, emailWindow),
	]);
	return result;
}

/**
 * Takes back one point, only if the window it was counted in is surely still
 * open. `availableIn` is rounded up to whole seconds and the limiter can't
 * refund into a named window, so this errs on the side of keeping the point.
 */
async function giveBack(
	counter: Limiter,
	key: string,
	countedAt: number,
	window: LimiterResponse,
) {
	const openForMs = (window.availableIn - REFUND_SLACK_SECONDS) * 1000;
	if (Date.now() - countedAt < openForMs) await counter.decrement(key);
}
