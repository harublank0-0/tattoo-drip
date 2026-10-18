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
export function browserChallengeHost(): ChallengeHost {
	return {
		loadScript(url, ready, failed) {
			const globals = window as unknown as Record<string, unknown>;
			globals[TURNSTILE_READY_CALLBACK] = () => {
				delete globals[TURNSTILE_READY_CALLBACK];
				ready();
			};
			const script = document.createElement("script");
			script.src = url;
			script.async = true;
			script.addEventListener(
				"error",
				() => {
					script.remove();
					delete globals[TURNSTILE_READY_CALLBACK];
					failed();
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
