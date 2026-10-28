import type { Limiter, LimiterResponse } from "@adonisjs/limiter";
import limiter from "@adonisjs/limiter/services/main";
import { typedEmail } from "#modules/identity/email_address";
import { clientAddress, digest } from "#services/rate_limits";

/**
 * The auth rate limits (TAT-8, TAT-18), by name. Each window is fixed: it
 * starts with the first counted attempt, and a lockout ends when it does
 * (no extra block). The request limits are `limiter.define` middleware in
 * start/limiter.ts; login and the current-password check count failures in
 * throttleLogin and throttlePasswordCheck below.
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
	/**
	 * Signups naming one email address, from any client address (TAT-18):
	 * each one emails that address (a confirmation link, or "you already
	 * have an account"). Per typed address: `+tags` and dots make different
	 * addresses (ruling 8), so the cap on mail to one mailbox is the 10
	 * signups per client address per hour above, not this.
	 */
	signupPerEmail: { requests: 3, duration: "1 hour" },
	/** Password reset requests from one client address (TAT-18). */
	resetPerIp: { requests: 10, duration: "1 hour" },
	/**
	 * Password reset requests naming one email address, registered or not,
	 * from any client address: the emails one typed address can get, and the
	 * guesses about it. Only a registered address is mailed, so `+tag`
	 * variants of a mailbox send nothing unless an account uses them.
	 */
	resetPerEmail: { requests: 3, duration: "1 hour" },
	/** Opening or using a reset or confirmation link, from one client address. */
	accountLinksPerIp: { requests: 30, duration: "15 mins" },
	/** "Send a new link": one a minute per account... */
	verifyResendCooldown: { requests: 1, duration: "1 min" },
	/** ...and five an hour. */
	verifyResendPerUser: { requests: 5, duration: "1 hour" },
	/**
	 * Wrong current passwords on the account page's "Change password" (TAT-95),
	 * for one account from any address. Only a signed-in session can try.
	 */
	passwordCheckPerUser: { requests: 5, duration: "15 mins" },
	/** ...and from one client address, across accounts. */
	passwordCheckPerIp: { requests: 10, duration: "15 mins" },
	/**
	 * Password changes (TAT-95), every request of one account: each success
	 * raises session_version and emails the notice. The wrong-password limit
	 * above stays the stricter one for guesses; if a stolen session burns this
	 * cap, a reset by email is the way back in (it needs the mailbox, not the
	 * session).
	 */
	passwordChangePerUser: { requests: 10, duration: "1 hour" },
	/**
	 * "Sign out of other devices" (TAT-95), per account AND client address. A
	 * stolen session can follow its re-issued cookie through every call, so a
	 * per-account cap alone lets it spend the owner's whole allowance from one
	 * address; keyed by address too, it spends only its own.
	 */
	signOutOthersPerAddress: { requests: 10, duration: "1 hour" },
	/**
	 * ...and a loose cap per account over every address: it bounds how fast
	 * session_version can grow and how often one account is written, however
	 * many addresses a stolen session comes from (10 an hour for a lifetime
	 * of addresses is not a bound: a thief with a whole /48 has 65,536 /64s).
	 * At 100 an hour the 9 digits a session can hold last over a million years.
	 * Ten distinct addresses are needed to reach it, and a reset or a password
	 * change (separate limits) stays the owner's way back.
	 */
	signOutOthersPerUser: { requests: 100, duration: "1 hour" },
} as const;

export function loginIpKey(ip: string) {
	return `login_ip_${digest(clientAddress(ip))}`;
}

/**
 * An email address's part of a count key: a digest, so the table holds no
 * address. It is the digest of the address as an account stores it
 * (`typedEmail`: surrounding whitespace dropped, A to Z lower-cased), so two
 * typings of one account share a count and two accounts never do. Don't
 * lower-case with toLowerCase(): it also folds non-ASCII letters, which
 * canonical addresses keep apart (`Éva@` and `éva@` are two accounts).
 */
export function emailCountKey(email: string) {
	return digest(typedEmail(email));
}

export function loginEmailKey(email: string) {
	return `login_email_${emailCountKey(email)}`;
}

/**
 * Forgets the failed logins counted for an account's address (TAT-18): a
 * completed password reset proves the mailbox, so someone else's guesses no
 * longer keep its owner out. Pass the address the account has STORED (the
 * reset knows the account, never a typed address). The client addresses'
 * counts stay: one address's attempts span many accounts.
 */
export async function clearLoginFailures(storedEmail: string) {
	await limiter
		.use({ ...AUTH_LIMITS.loginPerEmail })
		.delete(loginEmailKey(storedEmail));
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
 * made the earlier guesses (emails are canonical since TAT-18, so case
 * variants of an ASCII address are one account and one count). A point is
 * given back only while the window it was taken in is still open, so a slow
 * check can't erase failures of the next window. Any email is counted,
 * registered or not, so a lockout reveals nothing about accounts.
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

export function passwordCheckIpKey(ip: string) {
	return `password_check_ip_${digest(clientAddress(ip))}`;
}

export function passwordCheckUserKey(userId: string) {
	return `password_check_user_${digest(userId)}`;
}

/**
 * Runs `verify` (the current-password check of "Change password", TAT-95) unless
 * this address or this account is over its limit, and returns its answer.
 * Counted like a sign-in (throttleLogin): the address first, so a refused
 * address never adds to the account's count; both before `verify`, so parallel
 * guesses can't all pass a check first; a right password gives back the two
 * points it took while their windows are open, and wrong ones stay counted.
 * Over a limit it throws E_TOO_MANY_REQUESTS without checking.
 */
export async function throttlePasswordCheck(
	ip: string,
	userId: string,
	verify: () => Promise<boolean>,
): Promise<boolean> {
	// use() parses the durations in the object it gets, so give it copies.
	const perIp = limiter.use({ ...AUTH_LIMITS.passwordCheckPerIp });
	const perUser = limiter.use({ ...AUTH_LIMITS.passwordCheckPerUser });
	const ipKey = passwordCheckIpKey(ip);
	const userKey = passwordCheckUserKey(userId);

	const countedAt = Date.now();
	const ipWindow = await perIp.consume(ipKey);
	const userWindow = await perUser.consume(userKey);
	const right = await verify();
	if (right) {
		await Promise.all([
			giveBack(perIp, ipKey, countedAt, ipWindow),
			giveBack(perUser, userKey, countedAt, userWindow),
		]);
	}
	return right;
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
