import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	canAdd,
	EMPTY_REFERENCES,
	formatBytes,
	hasPhotoErrors,
	isPreparing,
	lostPhotos,
	nextToPrepare,
	type ReferencesAction,
	type ReferencesState,
	readyItems,
	referencesReducer,
	syncPreviews,
	totalBytes,
} from "../../src/intake/references.ts";

const file = (name: string, size = 10) =>
	new File([new Uint8Array(size)], name, { type: "image/jpeg" });
const jpeg = (size: number) =>
	new File([new Uint8Array(size)], "reference.jpg", { type: "image/jpeg" });

function run(...actions: ReferencesAction[]): ReferencesState {
	return actions.reduce(referencesReducer, EMPTY_REFERENCES);
}

const pick = (...names: string[]): ReferencesAction => ({
	type: "picked",
	files: names.map((name) => ({ id: `id-${name}`, file: file(name) })),
});

describe("picking photos", () => {
	test("queues them in order", () => {
		const state = run(pick("a.jpg", "b.jpg"));

		assert.deepEqual(
			state.items.map(({ id, name, status }) => [id, name, status]),
			[
				["id-a.jpg", "a.jpg", "queued"],
				["id-b.jpg", "b.jpg", "queued"],
			],
		);
		assert.deepEqual(state.notices, []);
	});

	test("takes at most 5, across picks, and says how many weren't added", () => {
		const state = run(pick("a", "b"), pick("c", "d", "e", "f", "g"));

		assert.deepEqual(
			state.items.map((item) => item.name),
			["a", "b", "c", "d", "e"],
		);
		assert.deepEqual(state.notices, [{ kind: "too-many", count: 2 }]);
		assert.equal(canAdd(state), false);

		const full = referencesReducer(state, pick("h"));
		assert.equal(full.items.length, 5);
		assert.deepEqual(full.notices, [{ kind: "too-many", count: 1 }]);
	});

	test("a new pick replaces the old messages", () => {
		const state = run(
			pick("a", "b", "c", "d", "e", "f"),
			{ type: "removed", id: "id-a" },
			pick("g"),
		);

		assert.deepEqual(state.notices, []);
		assert.equal(state.items.length, 5);
	});
});

describe("preparing photos one at a time", () => {
	test("offers the first queued photo, and nothing while one is in work", () => {
		const queued = run(pick("a", "b"));
		assert.equal(nextToPrepare(queued)?.id, "id-a");

		const working = referencesReducer(queued, { type: "started", id: "id-a" });
		assert.equal(working.workingId, "id-a");
		assert.equal(nextToPrepare(working), undefined);
		assert.equal(isPreparing(working), true);
	});

	test("a prepared photo is ready, drops its source, and frees the queue", () => {
		const prepared = jpeg(300);
		const state = run(
			pick("a", "b"),
			{ type: "started", id: "id-a" },
			{ type: "prepared", id: "id-a", file: prepared },
		);

		assert.equal(state.workingId, null);
		assert.equal(state.items[0].status, "ready");
		assert.equal(state.items[0].source, null);
		assert.equal(state.items[0].file, prepared);
		assert.equal(nextToPrepare(state)?.id, "id-b");
	});

	test("a refused photo leaves the tray with a message naming it", () => {
		const state = run(
			pick("IMG_1.HEIC", "b"),
			{ type: "started", id: "id-IMG_1.HEIC" },
			{ type: "refused", id: "id-IMG_1.HEIC", problem: "heic" },
		);

		assert.deepEqual(
			state.items.map((item) => item.name),
			["b"],
		);
		assert.deepEqual(state.notices, [{ kind: "heic", name: "IMG_1.HEIC" }]);
		assert.equal(state.workingId, null);
	});

	test("a photo removed mid-work stays gone and the next one waits", () => {
		const removed = run(
			pick("a", "b"),
			{ type: "started", id: "id-a" },
			{ type: "removed", id: "id-a" },
		);

		assert.deepEqual(
			removed.items.map((item) => item.id),
			["id-b"],
		);
		assert.equal(
			nextToPrepare(removed),
			undefined,
			"no second decode alongside the first",
		);
		assert.equal(isPreparing(removed), true);

		const settled = referencesReducer(removed, {
			type: "prepared",
			id: "id-a",
			file: jpeg(5),
		});
		assert.deepEqual(
			settled.items.map((item) => item.id),
			["id-b"],
			"it doesn't come back",
		);
		assert.equal(settled.workingId, null);
		assert.equal(nextToPrepare(settled)?.id, "id-b");
	});

	test("starting is only for the first queued photo, once", () => {
		const state = run(pick("a", "b"), { type: "started", id: "id-a" });

		assert.equal(
			referencesReducer(state, { type: "started", id: "id-b" }),
			state,
		);
		assert.equal(
			referencesReducer(run(pick("a")), { type: "started", id: "nope" })
				.workingId,
			null,
		);
	});
});

describe("photos lost while a send waits", () => {
	test("a photo refused during the wait is lost, and the others are not", () => {
		const waiting = run(pick("IMG_1.HEIC", "b"));
		const after = [
			{ type: "started", id: "id-IMG_1.HEIC" },
			{ type: "refused", id: "id-IMG_1.HEIC", problem: "heic" },
			{ type: "started", id: "id-b" },
			{ type: "prepared", id: "id-b", file: jpeg(5) },
		] satisfies ReferencesAction[];
		const settled = after.reduce(referencesReducer, waiting);

		assert.deepEqual(
			lostPhotos(waiting, settled).map((item) => item.name),
			["IMG_1.HEIC"],
		);
		assert.deepEqual(settled.notices, [{ kind: "heic", name: "IMG_1.HEIC" }]);
	});

	test("photos that all got prepared, or were added later, are not lost", () => {
		const waiting = run(pick("a", "b"));
		const prepared = [
			{ type: "started", id: "id-a" },
			{ type: "prepared", id: "id-a", file: jpeg(5) },
			{ type: "started", id: "id-b" },
			{ type: "prepared", id: "id-b", file: jpeg(5) },
		] satisfies ReferencesAction[];
		const settled = prepared.reduce(referencesReducer, waiting);

		assert.deepEqual(lostPhotos(waiting, settled), []);
		assert.deepEqual(
			lostPhotos(waiting, referencesReducer(settled, pick("c"))),
			[],
		);
		assert.deepEqual(lostPhotos(EMPTY_REFERENCES, EMPTY_REFERENCES), []);
	});

	test("a photo that was already refused before the wait is not counted again", () => {
		const before = run(
			pick("a", "b"),
			{ type: "started", id: "id-a" },
			{ type: "refused", id: "id-a", problem: "unreadable" },
		);
		const after = run(
			pick("a", "b"),
			{ type: "started", id: "id-a" },
			{ type: "refused", id: "id-a", problem: "unreadable" },
			{ type: "started", id: "id-b" },
			{ type: "prepared", id: "id-b", file: jpeg(5) },
		);

		assert.deepEqual(lostPhotos(before, after), []);
	});
});

describe("what is sent", () => {
	const ready = run(
		pick("a", "b", "c"),
		{ type: "started", id: "id-a" },
		{ type: "prepared", id: "id-a", file: jpeg(1_000) },
		{ type: "started", id: "id-b" },
		{ type: "prepared", id: "id-b", file: jpeg(2_000) },
	);

	test("only ready photos, in the tray's order, with their sizes", () => {
		assert.deepEqual(
			readyItems(ready).map((item) => item.id),
			["id-a", "id-b"],
		);
		assert.equal(totalBytes(ready), 3_000);
		assert.equal(isPreparing(ready), true, "c is still queued");
		assert.equal(canAdd(ready), true);
	});

	test("puts the API's photo errors on the photos that were sent, by their index then", () => {
		const sentIds = readyItems(ready).map((item) => item.id);
		const changed = run(
			pick("a", "b", "c"),
			{ type: "started", id: "id-a" },
			{ type: "prepared", id: "id-a", file: jpeg(1_000) },
			{ type: "started", id: "id-b" },
			{ type: "prepared", id: "id-b", file: jpeg(2_000) },
			{ type: "removed", id: "id-a" },
			pick("z"),
		);
		const rejected = referencesReducer(changed, {
			type: "rejected",
			sentIds,
			byIndex: { 0: "first", 1: "second" },
			error: null,
		});

		assert.deepEqual(
			rejected.items.map(({ id, error }) => [id, error]),
			[
				["id-b", "second"],
				["id-c", null],
				["id-z", null],
			],
		);
		assert.equal(hasPhotoErrors(rejected), true);
	});

	test("an error about the photos as a whole sits on the tray until the next change", () => {
		const rejected = referencesReducer(ready, {
			type: "rejected",
			sentIds: [],
			byIndex: {},
			error: "Attach up to 5 images.",
		});
		assert.equal(rejected.error, "Attach up to 5 images.");
		assert.equal(hasPhotoErrors(rejected), true);
		assert.equal(
			referencesReducer(rejected, { type: "removed", id: "id-c" }).error,
			null,
		);
	});

	test("cleared after a sent inquiry", () => {
		assert.deepEqual(
			referencesReducer(ready, { type: "cleared" }),
			EMPTY_REFERENCES,
		);
	});
});

describe("preview URLs", () => {
	function fakeUrls() {
		const created: string[] = [];
		const revoked: string[] = [];
		return {
			created,
			revoked,
			urls: {
				create: (photo: File) => {
					const url = `blob:${created.length}-${photo.size}`;
					created.push(url);
					return url;
				},
				revoke: (url: string) => {
					revoked.push(url);
				},
			},
		};
	}

	test("makes one URL per ready photo and keeps it while the photo stays", () => {
		const { created, urls } = fakeUrls();
		const state = run(
			pick("a", "b"),
			{ type: "started", id: "id-a" },
			{ type: "prepared", id: "id-a", file: jpeg(7) },
		);
		const first = syncPreviews(new Map(), state, urls);
		const again = syncPreviews(first, state, urls);

		assert.deepEqual([...again], [["id-a", "blob:0-7"]]);
		assert.deepEqual(created, ["blob:0-7"]);
	});

	test("makes no URL for a photo that isn't ready, and revokes the ones that went", () => {
		const { created, revoked, urls } = fakeUrls();
		const state = run(
			pick("a", "b"),
			{ type: "started", id: "id-a" },
			{ type: "prepared", id: "id-a", file: jpeg(7) },
		);
		const shown = syncPreviews(new Map(), state, urls);
		const removed = referencesReducer(state, { type: "removed", id: "id-a" });

		assert.deepEqual([...syncPreviews(shown, removed, urls)], []);
		assert.deepEqual(revoked, ["blob:0-7"]);
		assert.equal(created.length, 1, "nothing for the queued photo");

		const { revoked: cleared, urls: other } = fakeUrls();
		syncPreviews(new Map([["id-x", "blob:x"]]), EMPTY_REFERENCES, other);
		assert.deepEqual(cleared, ["blob:x"]);
	});
});

describe("formatBytes", () => {
	test("in MB with one decimal, never 0.0", () => {
		assert.equal(formatBytes(0), "0.1 MB");
		assert.equal(formatBytes(1024 * 1024), "1.0 MB");
		assert.equal(formatBytes(2_202_009), "2.1 MB");
	});
});
