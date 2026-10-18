import { Secret } from "@adonisjs/core/helpers";
import app from "@adonisjs/core/services/app";
import BotChallenge, { CHALLENGE_ACTIONS } from "#services/bot_challenge";

/** The secret the swapped verifier sends to the fake siteverify. */
export const TEST_SECRET = "test-turnstile-secret-55";

export type SiteverifyCall = { form: URLSearchParams };
export type Siteverify = {
	calls: SiteverifyCall[];
	fetch: typeof globalThis.fetch;
};

/**
 * A fake Cloudflare siteverify: records each call's form and answers with
 * `answer` (which gets the call's abort signal, to hang until a timeout).
 */
export function siteverify(
	answer: (
		form: URLSearchParams,
		signal: AbortSignal,
	) => Response | Promise<Response>,
): Siteverify {
	const calls: SiteverifyCall[] = [];
	const fetch = async (
		_input: string | URL | Request,
		init: RequestInit = {},
	) => {
		const form = new URLSearchParams(String(init.body));
		calls.push({ form });
		return answer(form, init.signal as AbortSignal);
	};
	return { calls, fetch: fetch as typeof globalThis.fetch };
}

/**
 * Cloudflare's verdict for a good token made on `slug`'s studio page
 * (`<slug>.localhost`, from .env.test's STOREFRONT_URL), with changes.
 */
export function verdict(slug: string, over: Record<string, unknown> = {}) {
	return Response.json({
		success: true,
		"error-codes": [],
		challenge_ts: new Date().toISOString(),
		hostname: `${slug}.localhost`,
		action: CHALLENGE_ACTIONS.inquiry,
		...over,
	});
}

/**
 * Turns the intake's bot challenge on for the test's requests: the real
 * verifier with TEST_SECRET, `fake` for Cloudflare, and the host and action
 * checked as in production. Undo it in teardown with
 * `app.container.restore(BotChallenge)`.
 */
export function useChallenge(
	fake: Siteverify,
	options: { timeoutMs?: number } = {},
) {
	app.container.swap(
		BotChallenge,
		() =>
			new BotChallenge({
				secret: new Secret(TEST_SECRET),
				fetch: fake.fetch,
				strict: true,
				...options,
			}),
	);
}
