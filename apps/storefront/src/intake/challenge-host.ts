import {
	type ChallengeHost,
	TURNSTILE_READY_CALLBACK,
	type TurnstileApi,
} from "./challenge.ts";

/**
 * The page's side of Challenge (TAT-57): one script tag from
 * challenges.cloudflare.com, Cloudflare's `turnstile` global and the
 * window's timers. Browser only, and only called from the form's handlers
 * and effects; the browser pass covers it.
 */

interface Waiter {
	readonly ready: () => void;
	readonly failed: () => void;
}

/**
 * The forms waiting for the script tag that is loading, or null. The script
 * and `window.turnstile` belong to the page, not to a form: the studio page
 * and an artist's page both mount the form and the router moves between them
 * without a reload, so a second mount must neither add a second tag (its
 * `onload` may never come) nor miss the one in flight.
 */
let loading: Waiter[] | null = null;

function finish(outcome: "ready" | "failed"): void {
	const waiters = loading ?? [];
	loading = null;
	for (const waiter of waiters) waiter[outcome]();
}

export function browserChallengeHost(): ChallengeHost {
	return {
		loadScript(url, ready, failed) {
			if (loading) {
				loading.push({ ready, failed });
				return;
			}
			const globals = window as unknown as Record<string, unknown>;
			if (globals.turnstile) {
				ready();
				return;
			}
			loading = [{ ready, failed }];
			globals[TURNSTILE_READY_CALLBACK] = () => {
				delete globals[TURNSTILE_READY_CALLBACK];
				finish("ready");
			};
			const script = document.createElement("script");
			script.src = url;
			script.async = true;
			script.addEventListener(
				"error",
				() => {
					script.remove();
					delete globals[TURNSTILE_READY_CALLBACK];
					finish("failed");
				},
				{ once: true },
			);
			document.head.append(script);
		},
		turnstile: () =>
			(window as unknown as { turnstile?: TurnstileApi }).turnstile,
		setTimer(run, ms) {
			const handle = window.setTimeout(run, ms);
			return () => window.clearTimeout(handle);
		},
	};
}
