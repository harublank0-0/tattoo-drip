import { fill } from "../intake/template.ts";
import { studioCopy } from "./copy.ts";
import type { VideoAngleView } from "./gallery.ts";

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

/** What one step of a tattoo shows: a photo or a video (video angles). */
export type ShotKind = "photo" | "video";

/** The viewer's place, by what it shows: "Photo 2 of 4", "Video 3 of 4". */
export function placeWords(kind: ShotKind, n: number, count: number): string {
	return fill(
		kind === "video" ? studioCopy.work.videoOf : studioCopy.work.photoOf,
		{
			n,
			count,
		},
	);
}

/**
 * The viewer's two steps. A tattoo of photos only keeps "Previous photo" and
 * "Next photo"; one with a video names what each step goes to ("Previous:
 * photo", "Next: video"), and at an end, where the step goes nowhere, the
 * plain word.
 */
export function stepWords(
	kinds: readonly ShotKind[],
	at: number,
): { previous: string; next: string } {
	if (!kinds.includes("video")) {
		return { previous: studioCopy.work.previous, next: studioCopy.work.next };
	}
	const kindWord = (kind: ShotKind) =>
		kind === "video" ? studioCopy.work.kindVideo : studioCopy.work.kindPhoto;
	const before = kinds[at - 1];
	const after = kinds[at + 1];
	return {
		previous: before
			? fill(studioCopy.work.previousOf, { kind: kindWord(before) })
			: studioCopy.work.previousPlain,
		next: after
			? fill(studioCopy.work.nextOf, { kind: kindWord(after) })
			: studioCopy.work.nextPlain,
	};
}

/**
 * Where focus goes when the tattoo page's viewer closes, by what the page
 * now shows (it shares the viewer's place): on a photo, the button that
 * opened the viewer is there, and the browser returns focus to it itself;
 * on a video (the visitor stepped to one), that button is gone, so focus
 * goes to that video's thumbnail in the row, never to the page.
 */
export function focusAfterViewerClose(
	kind: ShotKind,
	at: number,
): { target: "opener" } | { target: "thumbnail"; index: number } {
	return kind === "video"
		? { target: "thumbnail", index: at }
		: { target: "opener" };
}

/**
 * A video's element as the page renders it: never autoplayed, muted (it
 * has no sound anyway), inline on a phone, the browser's controls, nothing
 * fetched before play, its poster, its own size (the box is reserved), and
 * `loop` only when the visitor has not asked for reduced motion.
 */
export function videoAttributes(
	video: Pick<VideoAngleView, "width" | "height" | "poster" | "alt">,
	reducedMotion: boolean,
) {
	return {
		width: video.width,
		height: video.height,
		poster: video.poster.src,
		"aria-label": video.alt,
		muted: true,
		playsInline: true,
		loop: !reducedMotion,
		controls: true,
		preload: "none" as const,
		autoPlay: false,
	};
}
