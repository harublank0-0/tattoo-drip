import type { PhotoProblem } from "./copy.ts";
import { MAX_REFERENCES } from "./images.ts";

/*
 * The photo tray (TAT-57, spec ruling 5): what was picked, which photo is
 * being prepared (one at a time, even after it was removed, so two decodes
 * never run together on a low-end phone), what is ready to send, and why a
 * photo wasn't added. Pure: the form runs prepareReference and makes the
 * preview URLs (syncPreviews) around it.
 */

export interface ReferenceItem {
	readonly id: string;
	/** The picked file's name, for messages only (never sent). */
	readonly name: string;
	readonly status: "queued" | "ready";
	/** The picked file, until it is prepared. */
	readonly source: File | null;
	/** The re-encoded JPEG that is sent. */
	readonly file: File | null;
	/** What the API said about this photo when it was sent. */
	readonly error: string | null;
}

export type PhotoNotice =
	| { readonly kind: "too-many"; readonly count: number }
	| { readonly kind: PhotoProblem; readonly name: string };

export interface ReferencesState {
	readonly items: readonly ReferenceItem[];
	/** The photo being prepared, kept even if it was removed meanwhile. */
	readonly workingId: string | null;
	readonly notices: readonly PhotoNotice[];
	/** What the API said about the photos as a whole (`referenceImages`). */
	readonly error: string | null;
}

export const EMPTY_REFERENCES: ReferencesState = {
	items: [],
	workingId: null,
	notices: [],
	error: null,
};

export type ReferencesAction =
	| {
			readonly type: "picked";
			readonly files: readonly { readonly id: string; readonly file: File }[];
	  }
	| { readonly type: "started"; readonly id: string }
	| { readonly type: "prepared"; readonly id: string; readonly file: File }
	| {
			readonly type: "refused";
			readonly id: string;
			readonly problem: PhotoProblem;
	  }
	| { readonly type: "removed"; readonly id: string }
	| {
			readonly type: "rejected";
			/** The ids of the photos sent, in the order they were sent. */
			readonly sentIds: readonly string[];
			/** The API's message per sent index (`referenceImages.<i>`). */
			readonly byIndex: Readonly<Record<number, string>>;
			readonly error: string | null;
	  }
	| { readonly type: "cleared" };

export function referencesReducer(
	state: ReferencesState,
	action: ReferencesAction,
): ReferencesState {
	switch (action.type) {
		case "picked": {
			const room = Math.max(0, MAX_REFERENCES - state.items.length);
			const taken = action.files.slice(0, room);
			const left = action.files.length - taken.length;
			return {
				...state,
				items: [
					...state.items,
					...taken.map(
						({ id, file }): ReferenceItem => ({
							id,
							name: file.name,
							status: "queued",
							source: file,
							file: null,
							error: null,
						}),
					),
				],
				notices: left > 0 ? [{ kind: "too-many", count: left }] : [],
				error: null,
			};
		}
		case "started":
			return state.workingId === null && nextToPrepare(state)?.id === action.id
				? { ...state, workingId: action.id }
				: state;
		case "prepared":
			return {
				...state,
				workingId: settled(state, action.id),
				items: state.items.map(
					(item): ReferenceItem =>
						item.id === action.id
							? { ...item, status: "ready", source: null, file: action.file }
							: item,
				),
			};
		case "refused": {
			const refused = state.items.find((item) => item.id === action.id);
			return {
				...state,
				workingId: settled(state, action.id),
				items: state.items.filter((item) => item.id !== action.id),
				notices: refused
					? [...state.notices, { kind: action.problem, name: refused.name }]
					: state.notices,
			};
		}
		case "removed":
			return {
				...state,
				items: state.items.filter((item) => item.id !== action.id),
				error: null,
			};
		case "rejected":
			return {
				...state,
				error: action.error,
				items: state.items.map((item): ReferenceItem => {
					const index = action.sentIds.indexOf(item.id);
					const message = index === -1 ? undefined : action.byIndex[index];
					return message ? { ...item, error: message } : item;
				}),
			};
		case "cleared":
			return EMPTY_REFERENCES;
	}
}

function settled(state: ReferencesState, id: string): string | null {
	return state.workingId === id ? null : state.workingId;
}

/** The next photo to prepare: the first queued one, and none while one is in work. */
export function nextToPrepare(
	state: ReferencesState,
): ReferenceItem | undefined {
	return state.workingId === null
		? state.items.find((item) => item.status === "queued")
		: undefined;
}

/**
 * The photos `before` held that `after` no longer does. While a send waits
 * for the tray the person can't remove photos, so a photo that vanished was
 * refused: the send must stop and say so, not go without it.
 */
export function lostPhotos(
	before: ReferencesState,
	after: ReferencesState,
): readonly ReferenceItem[] {
	const kept = new Set(after.items.map((item) => item.id));
	return before.items.filter((item) => !kept.has(item.id));
}

/** Whether a send must wait for photos. */
export function isPreparing(state: ReferencesState): boolean {
	return (
		state.workingId !== null ||
		state.items.some((item) => item.status === "queued")
	);
}

type ReadyItem = ReferenceItem & { readonly file: File };

/** The photos that go with a send, in the tray's order. */
export function readyItems(state: ReferencesState): readonly ReadyItem[] {
	return state.items.filter(
		(item): item is ReadyItem => item.status === "ready" && item.file !== null,
	);
}

export function totalBytes(state: ReferencesState): number {
	return readyItems(state).reduce((sum, item) => sum + item.file.size, 0);
}

export function canAdd(state: ReferencesState): boolean {
	return state.items.length < MAX_REFERENCES;
}

export function hasPhotoErrors(state: ReferencesState): boolean {
	return (
		state.error !== null || state.items.some((item) => item.error !== null)
	);
}

export interface PreviewUrls {
	create(file: File): string;
	revoke(url: string): void;
}

/**
 * The preview URL of each ready photo: keeps the ones it has, makes the
 * missing ones, and revokes every URL whose photo is gone.
 */
export function syncPreviews(
	previous: ReadonlyMap<string, string>,
	state: ReferencesState,
	urls: PreviewUrls,
): ReadonlyMap<string, string> {
	const next = new Map<string, string>();
	for (const item of readyItems(state)) {
		next.set(item.id, previous.get(item.id) ?? urls.create(item.file));
	}
	for (const [id, url] of previous) {
		if (next.get(id) !== url) urls.revoke(url);
	}
	return next;
}

/** "2.1 MB": megabytes (MiB, as the API counts them) with one decimal, at least 0.1. */
export function formatBytes(bytes: number): string {
	return `${Math.max(0.1, bytes / (1024 * 1024)).toFixed(1)} MB`;
}
