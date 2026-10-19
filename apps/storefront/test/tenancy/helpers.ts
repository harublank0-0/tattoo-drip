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
