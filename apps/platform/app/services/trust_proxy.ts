import { isIP } from "node:net";

/**
 * TRUST_PROXY as start/env.ts reads it (TAT-38): the reverse proxies whose
 * X-Forwarded-For the app believes (config/app.ts, http.trustProxy, read by
 * proxy-addr). A list of proxy-addr names (`loopback`, `linklocal`,
 * `uniquelocal`), IP addresses and CIDR ranges, comma-separated; never
 * every address. Required in production, where the default (loopback)
 * would make every visitor behind a load balancer share its address;
 * unset elsewhere it is loopback. Imports nothing from the app.
 */
const NAMES = new Set(["loopback", "linklocal", "uniquelocal"]);

const RULE =
	"loopback, linklocal, uniquelocal, IP addresses or CIDR ranges, separated by commas, e.g. loopback, 10.0.0.0/8 (never every address)";

export function checkTrustProxy(
	key: string,
	value: string | undefined,
	production: boolean,
): string | undefined {
	const raw = value?.trim();
	if (!raw) {
		if (production) {
			throw new Error(
				`${key} is required in production: the reverse proxy's addresses, ${RULE}`,
			);
		}
		return undefined;
	}
	const entries = raw.split(",").map((entry) => entry.trim());
	if (entries.some((entry) => !isProxyEntry(entry))) {
		throw new Error(`${key} must list ${RULE}`);
	}
	return entries.join(", ");
}

function isProxyEntry(entry: string): boolean {
	if (NAMES.has(entry)) return true;
	const [address, prefix, ...rest] = entry.split("/");
	const family = isIP(address);
	if (family === 0 || rest.length > 0) return false;
	if (prefix === undefined) return true;
	if (!/^\d{1,3}$/.test(prefix)) return false;
	const bits = Number(prefix);
	return bits >= 1 && bits <= (family === 4 ? 32 : 128);
}
