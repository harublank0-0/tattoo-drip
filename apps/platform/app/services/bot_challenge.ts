import type { Secret } from "@adonisjs/core/helpers";
import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import env from "#start/env";

/** Cloudflare Turnstile's server-side check (TAT-55). */
export const SITEVERIFY_URL =
	"https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** The request header that carries the token (lower case, as Node gives it). */
export const CHALLENGE_TOKEN_HEADER = "x-challenge-token";

/** Turnstile tokens are at most this long; a longer one fails without a call. */
export const MAX_CHALLENGE_TOKEN_LENGTH = 2048;

/** How long the API waits for Cloudflare: the request holds its pooled connection meanwhile. */
export const CHALLENGE_TIMEOUT_MS = 3000;

/** The widget's `action` for each form that has a challenge. */
export const CHALLENGE_ACTIONS = { inquiry: "inquiry" } as const;

export type ChallengeOutcome = "passed" | "failed" | "unavailable";

/** Where a good token was made: the studio page's host and the form's action. */
export type ChallengeExpectation = { hostname: string; action: string };

export type BotChallengeOptions = {
	/** Unset: the check is off (development and tests; production requires it). */
	secret?: Secret<string>;
	fetch?: typeof globalThis.fetch;
	timeoutMs?: number;
	/**
	 * Also check the token's hostname and action. Default: in production
	 * only, so Cloudflare's test keys work locally.
	 */
	strict?: boolean;
};

/** Codes for a secret Cloudflare refuses: our misconfiguration, not the visitor's. */
const SECRET_REFUSED = new Set([
	"missing-input-secret",
	"invalid-input-secret",
]);

type Verdict = {
	success: boolean;
	"error-codes"?: string[];
	hostname?: string | null;
	action?: string | null;
};

/**
 * The intake's bot challenge (TAT-55): asks Cloudflare once, within
 * CHALLENGE_TIMEOUT_MS, whether a Turnstile token is good. `failed` is the
 * visitor's (no token, a bad, expired or reused one, made on another page
 * or for another form); `unavailable` is ours or Cloudflare's (no answer in
 * time, an answer that isn't a verdict, Cloudflare's own error, a refused
 * secret), and the API refuses on both. Logs a fixed cause only: never the
 * token, the secret or Cloudflare's body. Tests swap it in the container
 * (tests/helpers/challenge.ts).
 */
export default class BotChallenge {
	readonly #secret: Secret<string> | undefined;
	readonly #fetch: typeof globalThis.fetch;
	readonly #timeoutMs: number;
	readonly #strict: boolean;

	constructor(
		options: BotChallengeOptions = { secret: env.get("TURNSTILE_SECRET_KEY") },
	) {
		this.#secret = options.secret;
		this.#fetch = options.fetch ?? globalThis.fetch;
		this.#timeoutMs = options.timeoutMs ?? CHALLENGE_TIMEOUT_MS;
		this.#strict = options.strict ?? app.inProduction;
	}

	async verify(
		token: string | undefined,
		expected: ChallengeExpectation,
	): Promise<ChallengeOutcome> {
		if (!this.#secret) return "passed";
		if (!token?.trim() || token.length > MAX_CHALLENGE_TOKEN_LENGTH) {
			return "failed";
		}

		let response: Response;
		try {
			response = await this.#fetch(SITEVERIFY_URL, {
				method: "POST",
				body: new URLSearchParams({
					secret: this.#secret.release(),
					response: token,
				}),
				// A redirect would send the secret again to wherever it points.
				redirect: "error",
				signal: AbortSignal.timeout(this.#timeoutMs),
			});
		} catch (error) {
			return unavailable(isTimeout(error) ? "timeout" : "network error");
		}
		if (!response.ok) return unavailable(`status ${response.status}`);

		let body: unknown;
		try {
			body = await response.json();
		} catch (error) {
			return unavailable(isTimeout(error) ? "timeout" : "not JSON");
		}
		if (!isVerdict(body)) return unavailable("not a verdict");

		if (!body.success) {
			const codes = body["error-codes"] ?? [];
			if (codes.some((code) => SECRET_REFUSED.has(code))) {
				logger.error("Bot challenge: Cloudflare refused TURNSTILE_SECRET_KEY");
				return "unavailable";
			}
			if (codes.includes("internal-error")) {
				return unavailable("Cloudflare error");
			}
			return "failed";
		}
		if (
			this.#strict &&
			(body.hostname?.toLowerCase() !== expected.hostname ||
				body.action !== expected.action)
		) {
			return "failed";
		}
		return "passed";
	}
}

function unavailable(cause: string): ChallengeOutcome {
	logger.warn({ cause }, "Bot challenge check unavailable");
	return "unavailable";
}

function isTimeout(error: unknown) {
	return error instanceof DOMException && error.name === "TimeoutError";
}

function isText(value: unknown) {
	return value === undefined || value === null || typeof value === "string";
}

/** Cloudflare's answer, as far as we read it; anything else is no answer. */
function isVerdict(body: unknown): body is Verdict {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return false;
	}
	const fields = body as Record<string, unknown>;
	const codes = fields["error-codes"];
	return (
		typeof fields.success === "boolean" &&
		(codes === undefined ||
			(Array.isArray(codes) &&
				codes.every((code) => typeof code === "string"))) &&
		isText(fields.hostname) &&
		isText(fields.action)
	);
}
