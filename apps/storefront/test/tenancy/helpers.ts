import type { Studio } from "@tattoo-drip/sdk";
import { DEFAULT_STOREFRONT } from "../studio/fixtures.ts";

/** Fakes shared by the tenancy tests, in the style of the SDK's own tests. */

export type Call = { url: string; init: RequestInit };

/** A fetch that records each call and answers with `respond`. */
export function fakeFetch(
	respond: (call: Call) => Response | Promise<Response>,
) {
	const calls: Call[] = [];
	const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const call = { url: String(input), init };
		calls.push(call);
		return respond(call);
	};
	return { calls, fetch: fetch as typeof globalThis.fetch };
}

/**
 * A shared cache (a CDN) in front of the API, as docs/architecture.md and
 * deploy.md describe it: it keeps the first answer and serves that copy,
 * with an `Age`, to every later request, unless the request asks for a
 * fresh one with `Cache-Control: no-cache`. `origin()` is the API itself.
 */
export function cdnInFront(origin: () => Response) {
	let stored: { status: number; body: string; headers: Headers } | undefined;
	let hits = 0;
	const fetch = async (_input: RequestInfo | URL, init: RequestInit = {}) => {
		const wantsFresh = /\bno-cache\b/.test(
			new Headers(init.headers).get("cache-control") ?? "",
		);
		if (stored && !wantsFresh) {
			hits++;
			const headers = new Headers(stored.headers);
			headers.set("age", "540");
			return new Response(stored.body, { status: stored.status, headers });
		}
		const answer = origin();
		stored = {
			status: answer.status,
			body: await answer.clone().text(),
			headers: new Headers(answer.headers),
		};
		return answer;
	};
	return {
		fetch: fetch as typeof globalThis.fetch,
		/** How many answers came from the stored copy. */
		get hits() {
			return hits;
		},
	};
}

export function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

/** Rejects with the signal's reason once it aborts, as fetch does. */
export function hangUntilAborted({ init }: Call): Promise<Response> {
	const signal = init.signal as AbortSignal;
	return new Promise((_, reject) => {
		signal.addEventListener("abort", () => reject(signal.reason), {
			once: true,
		});
	});
}

/** A whole Studio (TAT-44's contract) where only the slug and the name matter. */
export function studioOf(slug: string, name: string): Studio {
	return {
		slug,
		name,
		type: "studio",
		intro: null,
		timezone: "Asia/Kathmandu",
		contact: { phone: null, email: null, address: null },
		socialLinks: [],
		acceptingInquiries: true,
		cover: null,
		storefront: DEFAULT_STOREFRONT,
		openingHours: [],
		closedDays: [],
		goodToKnow: {
			walkIns: null,
			ageRule: null,
			depositPolicy: null,
			beforeSession: null,
			aftercare: null,
		},
	};
}
