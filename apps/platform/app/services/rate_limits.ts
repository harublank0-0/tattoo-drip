import { createHmac } from "node:crypto";
import { isIPv6 } from "node:net";
import env from "#start/env";

/**
 * HMAC-SHA256 of `value` with APP_KEY, base64url (43 characters), for
 * rate-limit keys (TAT-8). Keyed, so the stored keys can't be reversed by
 * hashing guessed emails or the small IPv4 space; fixed length, so a long
 * email still fits the 255-character key column. Rotating APP_KEY resets
 * every count.
 */
export function digest(value: string) {
	return createHmac("sha256", env.get("APP_KEY").release())
		.update(value)
		.digest("base64url");
}

/**
 * The client address a limit counts by: IPv4 as is (also written
 * IPv4-mapped, `::ffff:203.0.113.7`), and IPv6 by its /64, the block one
 * subscriber gets, so cycling through it buys no fresh attempts. Anything
 * that isn't an IPv6 address is returned as it is.
 */
export function clientAddress(ip: string) {
	return countedBlock(ip, 4);
}

/**
 * A coarser count for a limit a thief with a stolen session can reach (TAT-95:
 * "Sign out of other devices"): IPv4 as is, and IPv6 by its /48, the block a
 * site or a household plan gets, so cycling through the 65,536 /64s inside it
 * buys no fresh allowance. Only that limiter uses it; the others keep the
 * /64 of `clientAddress`.
 */
export function clientNetwork(ip: string) {
	return countedBlock(ip, 3);
}

/** IPv4 as is; IPv6 by its first `groups` 16-bit groups (4 is the /64, 3 the /48). */
function countedBlock(ip: string, groups: 3 | 4) {
	const address = ip.split("%")[0].toLowerCase();
	if (!isIPv6(address)) return address;

	const all = ipv6Groups(address);
	const mapped =
		all.slice(0, 5).every((group) => group === 0) && all[5] === 0xffff;
	if (mapped) {
		return [all[6], all[7]]
			.flatMap((group) => [Math.floor(group / 256), group % 256])
			.join(".");
	}
	const prefix = all.slice(0, groups).map((group) => group.toString(16));
	return `${prefix.join(":")}::/${groups * 16}`;
}

/** The eight 16-bit groups of a valid IPv6 address. */
function ipv6Groups(address: string) {
	const [head, tail] = address.split("::");
	if (tail === undefined) return groupsOf(head);
	const left = groupsOf(head);
	const right = groupsOf(tail);
	const zeros = new Array<number>(8 - left.length - right.length).fill(0);
	return [...left, ...zeros, ...right];
}

/** Hex groups as numbers; a trailing dotted IPv4 part fills two groups. */
function groupsOf(part: string): number[] {
	if (!part) return [];
	return part.split(":").flatMap((group) => {
		if (!group.includes(".")) return [Number.parseInt(group, 16)];
		const [a, b, c, d] = group.split(".").map(Number);
		return [a * 256 + b, c * 256 + d];
	});
}

/** What a refused form shows: whole minutes, rounded up, at least one. */
export function tryAgainMessage(seconds: number) {
	const minutes = Math.max(1, Math.ceil(seconds / 60));
	const unit = minutes === 1 ? "minute" : "minutes";
	return `Too many attempts. Try again in ${minutes} ${unit}.`;
}

/**
 * The account links a person opens from an email or a chat (TAT-18, TAT-33):
 * their GET only stages a token and redirects. Over the limit they show
 * `LINK_THROTTLED_MESSAGE` instead of going back to a form they were never on.
 */
export const ACCOUNT_LINK_ROUTES: readonly string[] = [
	"email_verification.link",
	"invitations.link",
	"password_reset.link",
];

/**
 * What a throttled account link says (TAT-119). The same words whatever the
 * token is, so the answer never tells whether a link is valid or an address
 * is known; no number of minutes, for the same reason.
 */
export const LINK_THROTTLED_MESSAGE =
	"Too many tries. Wait a few minutes and open the link again.";
