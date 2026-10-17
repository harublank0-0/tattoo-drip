/**
 * Whether a response may encrypt Inertia's page history (TAT-82).
 *
 * The browser encrypts with crypto.subtle, which exists only in a secure
 * context: HTTPS, or a loopback host. Over plain HTTP from another device
 * (a phone opening the dev server at its LAN IP) Inertia's encryption
 * throws and every later visit hangs, so development skips it there.
 * Production always encrypts: it is HTTPS-only (secure cookies), and behind
 * a proxy the request's protocol can read "http" anyway.
 */
type RequestOrigin = { protocol(): string; hostname(): string | null };

const LOOPBACK_IPV4 = /^127(\.\d{1,3}){3}$/;

export function encryptsHistory(
	request: RequestOrigin,
	inProduction: boolean,
): boolean {
	if (inProduction || request.protocol() === "https") {
		return true;
	}

	const host = request.hostname()?.toLowerCase();
	if (!host) {
		return false;
	}

	return (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host === "[::1]" ||
		LOOPBACK_IPV4.test(host)
	);
}
