import { INQUIRY_CHALLENGE_ACTION } from "@tattoo-drip/sdk";

/*
 * Cloudflare Turnstile for the intake form (TAT-55/57, spec ruling 6): the
 * one third-party script the studio page loads, only once someone starts
 * filling in the form. Rendered in execute mode, run at Send, reset after
 * every attempt (a token is single-use). The page's side (the script tag,
 * the global `turnstile`, timers) sits behind ChallengeHost:
 * challenge-host.ts in the browser, a fake in the tests.
 */

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
/** The global function Turnstile calls once it is ready (its `onload` parameter). */
export const TURNSTILE_READY_CALLBACK = "tattooDripTurnstileReady";
export const TURNSTILE_SCRIPT_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit&onload=${TURNSTILE_READY_CALLBACK}`;
/** Cloudflare's Turnstile Privacy Addendum, linked from the form's privacy line. */
export const TURNSTILE_PRIVACY_URL =
	"https://www.cloudflare.com/turnstile-privacy-policy/";
/** How long a send waits for the script (about 50 KB on a slow phone). */
export const SCRIPT_TIMEOUT_MS = 20_000;
/** How long a send waits for a token while no checkbox is showing. */
export const TOKEN_TIMEOUT_MS = 30_000;

export interface TurnstileRenderOptions {
	sitekey: string;
	action: string;
	execution: "execute";
	appearance: "interaction-only";
	size: "flexible";
	theme: "auto";
	retry: "never";
	"refresh-expired": "manual";
	"response-field": false;
	"feedback-enabled": false;
	callback: (token: string) => void;
	"error-callback": (code: string) => boolean;
	"expired-callback": () => void;
	"timeout-callback": () => void;
	"unsupported-callback": () => void;
	"before-interactive-callback": () => void;
	"after-interactive-callback": () => void;
}

/** The part of Cloudflare's `turnstile` global the form uses. */
export interface TurnstileApi {
	render(
		container: HTMLElement,
		options: TurnstileRenderOptions,
	): string | null | undefined;
	execute(widget: string): void;
	reset(widget: string): void;
	remove(widget: string): void;
}

export interface ChallengeHost {
	/** Adds the script; `ready` once Turnstile is ready, `failed` if the script can't load (it is then removed). */
	loadScript(url: string, ready: () => void, failed: () => void): void;
	/** Cloudflare's global, once the script ran. */
	turnstile(): TurnstileApi | undefined;
	/** Runs `run` after `ms`; returns a function that cancels it. */
	setTimer(run: () => void, ms: number): () => void;
}

export type ChallengeFailure = "blocked" | "expired" | "unsupported";

export type ChallengeResult =
	| { readonly ok: true; readonly token: string }
	| { readonly ok: false; readonly reason: ChallengeFailure };

interface Attempt {
	readonly promise: Promise<ChallengeResult>;
	readonly resolve: (result: ChallengeResult) => void;
	cancelTimer: (() => void) | null;
}

export class Challenge {
	readonly #siteKey: string;
	readonly #host: ChallengeHost;
	readonly #onInteractive: (interactive: boolean) => void;
	#script: "none" | "loading" | "ready" = "none";
	#waiters: Array<(ready: boolean) => void> = [];
	#container: HTMLElement | null = null;
	#widget: string | null = null;
	#attempt: Attempt | null = null;

	/** `onInteractive` hears when Cloudflare shows its checkbox, and when that ends. */
	constructor(
		siteKey: string,
		host: ChallengeHost,
		onInteractive: (interactive: boolean) => void = () => {},
	) {
		this.#siteKey = siteKey;
		this.#host = host;
		this.#onInteractive = onInteractive;
	}

	/** Starts loading the script, once (the form's first focus or tap). */
	preload(): void {
		if (this.#script !== "none") return;
		this.#script = "loading";
		this.#host.loadScript(
			TURNSTILE_SCRIPT_URL,
			() => this.#loaded(true),
			() => this.#loaded(false),
		);
	}

	/** Whether Turnstile is ready: false after SCRIPT_TIMEOUT_MS or a failed load (a later call tries again). */
	load(): Promise<boolean> {
		if (this.#script === "ready") return Promise.resolve(true);
		this.preload();
		return new Promise((resolve) => {
			let done = false;
			const finish = (ready: boolean) => {
				if (done) return;
				done = true;
				cancel();
				resolve(ready);
			};
			const cancel = this.#host.setTimer(
				() => finish(false),
				SCRIPT_TIMEOUT_MS,
			);
			this.#waiters.push(finish);
		});
	}

	/** Where the widget goes: it stays empty unless Cloudflare needs a tap. */
	attach(container: HTMLElement | null): void {
		this.#container = container;
		this.#render();
	}

	/** A fresh token for one attempt; two calls at once share it. */
	async token(): Promise<ChallengeResult> {
		const sharing = this.#waiting();
		if (sharing) return sharing;
		if (!(await this.load())) return { ok: false, reason: "blocked" };
		// Another call may have started the attempt while this one waited.
		const started = this.#waiting();
		if (started) return started;
		const widget = this.#render();
		const api = this.#host.turnstile();
		if (widget === null || !api) return { ok: false, reason: "blocked" };
		let resolve: (result: ChallengeResult) => void = () => {};
		const promise = new Promise<ChallengeResult>((done) => {
			resolve = done;
		});
		this.#attempt = { promise, resolve, cancelTimer: null };
		this.#armTimer();
		api.execute(widget);
		return promise;
	}

	/** After every attempt, whatever the answer: a token is single-use. */
	reset(): void {
		this.#settle({ ok: false, reason: "blocked" });
		const api = this.#host.turnstile();
		if (this.#widget !== null && api) api.reset(this.#widget);
	}

	/** When the form goes away. */
	dispose(): void {
		this.#settle({ ok: false, reason: "blocked" });
		const api = this.#host.turnstile();
		if (this.#widget !== null && api) api.remove(this.#widget);
		this.#widget = null;
		this.#container = null;
	}

	/** The running attempt's promise (read through a method so TypeScript doesn't narrow it across an await). */
	#waiting(): Promise<ChallengeResult> | null {
		return this.#attempt?.promise ?? null;
	}

	#loaded(ready: boolean): void {
		this.#script = ready ? "ready" : "none";
		const waiters = this.#waiters;
		this.#waiters = [];
		for (const waiter of waiters) waiter(ready);
		if (ready) this.#render();
	}

	#render(): string | null {
		if (this.#widget !== null) return this.#widget;
		const api = this.#script === "ready" ? this.#host.turnstile() : undefined;
		if (!api || !this.#container) return null;
		this.#widget = api.render(this.#container, this.#options()) ?? null;
		return this.#widget;
	}

	#options(): TurnstileRenderOptions {
		return {
			sitekey: this.#siteKey,
			action: INQUIRY_CHALLENGE_ACTION,
			execution: "execute",
			appearance: "interaction-only",
			size: "flexible",
			theme: "auto",
			retry: "never",
			"refresh-expired": "manual",
			"response-field": false,
			"feedback-enabled": false,
			callback: (token) => this.#settle({ ok: true, token }),
			"error-callback": () => {
				this.#settle({ ok: false, reason: "blocked" });
				return true;
			},
			"expired-callback": () => {},
			"timeout-callback": () => this.#settle({ ok: false, reason: "expired" }),
			"unsupported-callback": () =>
				this.#settle({ ok: false, reason: "unsupported" }),
			"before-interactive-callback": () => {
				if (this.#attempt) {
					this.#attempt.cancelTimer?.();
					this.#attempt.cancelTimer = null;
				}
				this.#onInteractive(true);
			},
			"after-interactive-callback": () => {
				this.#onInteractive(false);
				this.#armTimer();
			},
		};
	}

	#armTimer(): void {
		const attempt = this.#attempt;
		if (!attempt) return;
		attempt.cancelTimer?.();
		attempt.cancelTimer = this.#host.setTimer(
			() => this.#settle({ ok: false, reason: "blocked" }),
			TOKEN_TIMEOUT_MS,
		);
	}

	#settle(result: ChallengeResult): void {
		const attempt = this.#attempt;
		if (!attempt) return;
		this.#attempt = null;
		attempt.cancelTimer?.();
		this.#onInteractive(false);
		attempt.resolve(result);
	}
}
