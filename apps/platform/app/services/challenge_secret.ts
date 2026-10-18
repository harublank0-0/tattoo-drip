import { Secret } from "@adonisjs/core/helpers";

/**
 * Checks TURNSTILE_SECRET_KEY as start/env.ts reads it (TAT-55): the secret
 * key of the studio pages' Cloudflare Turnstile widget, which the API sends
 * to Cloudflare to check each intake's bot-challenge token. Required in
 * production; unset or empty elsewhere, the check is off and any request
 * passes it. Returned as a Secret, so it never prints in a log. This file
 * imports nothing from the app, because start/env.ts runs it while the
 * environment is still being read; its messages never contain the value.
 */
export function checkChallengeSecret(
	key: string,
	value: string | undefined,
	production: boolean,
): Secret<string> | undefined {
	if (!value) {
		if (production) {
			throw new Error(
				`${key} is required in production: the secret key of the studio pages' Cloudflare Turnstile widget (Cloudflare dashboard, Turnstile, the widget's settings)`,
			);
		}
		return undefined;
	}
	if (/\s/.test(value)) {
		throw new Error(
			`${key} must not contain spaces or line breaks: copy the secret key again`,
		);
	}
	return new Secret(value);
}
