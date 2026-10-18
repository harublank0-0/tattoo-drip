import { Secret } from "@adonisjs/core/helpers";

/**
 * STOREFRONT_SERVER_KEYS as start/env.ts reads it (TAT-38): the storefront
 * server's key (its STOREFRONT_SERVER_KEY), or two while rotating
 * (old,new). A valid key only makes the storefront's server-side calls
 * count per visitor; it grants nothing. Each key follows the storefront's
 * rule (RFC 7235 token68). This file imports nothing from the app, because
 * start/env.ts runs it while the environment is still being read; its
 * messages never contain a value.
 */
export const SERVER_KEY_SHAPE = /^[A-Za-z0-9._~+/-]{32,256}={0,2}$/;

export const MAX_SERVER_KEYS = 2;

export const SERVER_KEY_RULE =
	"one or two keys separated by a comma, each 32 to 256 letters, digits or -._~+/ characters, then at most two = of padding (make one with openssl rand -base64 32)";

export function checkServerKeys(
	key: string,
	value: string | undefined,
	production: boolean,
): Secret<readonly string[]> | undefined {
	const raw = value?.trim();
	if (!raw) {
		if (production) {
			throw new Error(
				`${key} is required in production: the storefront's STOREFRONT_SERVER_KEY, ${SERVER_KEY_RULE}`,
			);
		}
		return undefined;
	}
	const keys = raw.split(",").map((entry) => entry.trim());
	if (
		keys.length > MAX_SERVER_KEYS ||
		keys.some((entry) => !SERVER_KEY_SHAPE.test(entry))
	) {
		throw new Error(`${key} is invalid: it must be ${SERVER_KEY_RULE}`);
	}
	return new Secret(Object.freeze(keys));
}
