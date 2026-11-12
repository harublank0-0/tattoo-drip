/**
 * Angles: the rules of a tattoo's viewer and row of photos (angles.tsx), as
 * plain functions, so the tests run them without a DOM. Pure.
 */

/** A horizontal move of at least this many CSS pixels on the photo is a swipe. */
export const SWIPE = 48;

/** The photo `delta` places on from `at`, held at the ends (no wrap: the ends are where the buttons stop). */
export function stepTo(at: number, delta: number, count: number): number {
	return Math.min(Math.max(at + delta, 0), Math.max(count - 1, 0));
}

/** A photo chosen in the row, held to the tattoo's photos. */
export function selectIndex(index: number, count: number): number {
	return stepTo(0, index, count);
}

/**
 * Which way a key steps the viewer: +1, -1 or 0 (not a step). Only the bare
 * arrow keys: with Alt, Meta or Ctrl they are the browser's (Alt+Left is
 * Back, which closes the viewer), and Shift is left to the page too.
 */
export function keyStep(event: {
	key: string;
	altKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
}): -1 | 0 | 1 {
	if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
		return 0;
	}
	if (event.key === "ArrowRight") return 1;
	if (event.key === "ArrowLeft") return -1;
	return 0;
}

/** A swipe in progress: the primary pointer that started it and where. */
export type Swipe = { readonly pointerId: number; readonly x: number } | null;

/** A pointer goes down on the photo: only the primary one starts a swipe; a second finger (a pinch) ends it. */
export function swipeStart(event: {
	pointerId: number;
	isPrimary: boolean;
	clientX: number;
}): Swipe {
	return event.isPrimary
		? { pointerId: event.pointerId, x: event.clientX }
		: null;
}

/**
 * A pointer goes up: the step its swipe makes (+1 for a move to the left,
 * the next photo; -1 to the right; 0 for a short move, another pointer or
 * no swipe at all).
 */
export function swipeEnd(
	swipe: Swipe,
	event: { pointerId: number; clientX: number },
): -1 | 0 | 1 {
	if (swipe === null || event.pointerId !== swipe.pointerId) return 0;
	const moved = event.clientX - swipe.x;
	if (Math.abs(moved) < SWIPE) return 0;
	return moved < 0 ? 1 : -1;
}

/**
 * Where a viewer opens next time: a grid's viewer (its own index) on the
 * main photo again; the tattoo page's (the index it shares with the page) on
 * the photo the page shows, which is the last one viewed.
 */
export function indexAfterClose(at: number, shared: boolean): number {
	return shared ? at : 0;
}
