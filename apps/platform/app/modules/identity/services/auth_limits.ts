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
 * Runs `verify` (the credential check) unless this address or this email is
 * over its login limit. Over the limit, it throws E_TOO_MANY_REQUESTS
 * without checking the password. The address is counted first, so a refused
 * address never adds to the email's count. Both counts are taken before
 * `verify` runs, so parallel guesses can't all pass a check first. A sign-in
 * gives the address its attempt back and clears the email's failures. Any
 * email is counted, registered or not, so a lockout reveals nothing about
 * accounts.
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

	await perIp.consume(ipKey);
	await perEmail.consume(emailKey);
	const result = await verify();
	await Promise.all([perIp.decrement(ipKey), perEmail.delete(emailKey)]);
	return result;
}
