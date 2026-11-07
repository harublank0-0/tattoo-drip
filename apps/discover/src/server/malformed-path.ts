import { definePlugin } from "nitro";
import { SECURITY_HEADERS } from "../lib/headers.ts";

/**
 * True when a request path's percent-encoding can't be decoded (`/%ff`,
 * `/tattoos/%E0%A4`, `/%`): not a valid UTF-8 URL.
 */
export function malformedPath(url: string): boolean {
	try {
		decodeURI(new URL(url, "http://localhost").pathname);
		return false;
	} catch {
		return true;
	}
}

/**
 * The security headers on a response that has none (D10): the few answers
 * produced before Start's middleware and Nitro's route rules run, such as
 * Start's 308 for a protocol-relative path (`//host/x`). Everything else
 * already carries them and is returned as it is.
 */
export function withSecurityHeaders(response: Response): Response {
	if (response.headers.has("X-Content-Type-Options")) return response;
	const headers = new Headers(response.headers);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (!headers.has(name)) headers.set(name, value);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

/**
 * D10 phase B: h3 decodes every path when it creates the request's event,
 * before any middleware runs, and a path that can't be decoded threw there:
 * the request never got an answer (it hung until the client or nginx gave
 * up, 130 s), so anyone could hold connections open with one cheap request.
 * Such a request now gets a plain 400 at once, with the security headers,
 * and every other answer leaves with them too (`withSecurityHeaders`).
 * Registered in vite.config.ts (`nitro({ plugins })`).
 */
export default definePlugin((nitroApp) => {
	const handle = nitroApp.fetch;
	nitroApp.fetch = async (request) =>
		malformedPath(request.url)
			? new Response("Bad request", {
					status: 400,
					headers: {
						...SECURITY_HEADERS,
						"Content-Type": "text/plain; charset=utf-8",
						"Cache-Control": "no-store",
					},
				})
			: withSecurityHeaders(await handle(request));
});
