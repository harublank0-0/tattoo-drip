/**
 * The dashboard's visit rules (TAT-84), installed once by `app.tsx` for every layout. A visit the
 * network cut off (no answer at all) gets a toast saying so, instead of the button quietly going
 * back to normal. It imports nothing, so the unit tests load it with a jsdom document passed in
 * (`visits.spec.ts`).
 */

export const PAGE_LOST =
	"Couldn't load the page. Check your connection and try again.";
export const SAVE_LOST =
	"The connection dropped before this was confirmed. Open the page again to see whether it saved, then try again if it didn't.";

/** The toast for a visit the network cut off: a page load (GET) or a save (anything else). */
export function connectionLostText(method: string): string {
	return method.toLowerCase() === "get" ? PAGE_LOST : SAVE_LOST;
}

type VisitEvent = { detail: { visit?: { method: string } } };
/** Inertia's `router.on`, narrowed to the events used here. */
export type OnVisit = (
	type: "error" | "networkError" | "finish",
	callback: (event: VisitEvent) => boolean | undefined,
) => () => void;

/**
 * Installs the dashboard's visit rules and returns what removes them. A visit the network
 * cut off (no answer at all) gets a toast at its `finish`, which carries the method; the
 * `networkError` handler returns false, so Inertia does not reject the visit's promise.
 * It never retries: a save may have reached the server before the answer was lost.
 */
export function watchVisits(
	on: OnVisit,
	_doc: Document,
	notify: (text: string) => void,
): () => void {
	let lost = false;
	const stops = [
		on("networkError", () => {
			lost = true;
			return false;
		}),
		on("finish", (event) => {
			if (lost) notify(connectionLostText(event.detail.visit?.method ?? "get"));
			lost = false;
			return undefined;
		}),
	];
	return () => {
		for (const stop of stops) stop();
	};
}
