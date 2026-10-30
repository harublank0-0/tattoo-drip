import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import type * as Lightbox from "../../src/studio/lightbox.ts";
import { PHOTO_ENTRY } from "../../src/studio/lightbox.ts";

/**
 * Back closes the work photo viewer (TAT-123). lightbox.ts reads the browser's
 * globals when showPhoto is called, so the browser is stood in by plain
 * objects: a window that keeps listeners, a session history that records what
 * was done to it, and dialogs that fire `close`. The instance's own
 * pushState / replaceState throw, as a stand-in for TanStack's wrappers: they
 * tell the router, which would run the page's loaders, so the viewer must go
 * through History.prototype, the browser's own.
 *
 * Each test loads its own copy of the module (a query on the address), after
 * the globals are in place: the module looks at the entry the page was loaded
 * on when it loads, and keeps whether a closed photo is still leaving in the
 * module, so a copy per test is a page load per test.
 */
const globals = globalThis as Record<string, unknown>;
const saved = {
	document: globals.document,
	window: globals.window,
	HTMLDialogElement: globals.HTMLDialogElement,
	History: globals.History,
};

afterEach(() => {
	mock.timers.reset();
	for (const [name, value] of Object.entries(saved)) {
		if (value === undefined) delete globals[name];
		else globals[name] = value;
	}
});

type Listener = (event?: unknown) => void;

class Target {
	#listeners = new Map<string, { fn: Listener; once: boolean }[]>();
	addEventListener(
		type: string,
		fn: Listener,
		options?: { once?: boolean },
	): void {
		const list = this.#listeners.get(type) ?? [];
		list.push({ fn, once: options?.once === true });
		this.#listeners.set(type, list);
	}
	removeEventListener(type: string, fn: Listener): void {
		const list = this.#listeners.get(type) ?? [];
		this.#listeners.set(
			type,
			list.filter((entry) => entry.fn !== fn),
		);
	}
	dispatch(type: string): void {
		for (const entry of [...(this.#listeners.get(type) ?? [])]) {
			if (entry.once) this.removeEventListener(type, entry.fn);
			entry.fn({ type });
		}
	}
	count(type: string): number {
		return (this.#listeners.get(type) ?? []).length;
	}
}

class FakeWindow extends Target {
	history!: FakeHistory;
	assigned: string[] = [];
	location = { assign: (url: string) => this.assigned.push(url) };
}

/** The browser's session history: `back()` only records, the test moves it with `pop()`. */
class FakeHistory {
	entries: unknown[];
	index = 0;
	calls: string[] = [];
	urls: unknown[] = [];
	window: FakeWindow;

	constructor(window: FakeWindow, state: unknown) {
		this.window = window;
		this.entries = [state];
	}
	get state(): unknown {
		return this.entries[this.index];
	}
	pushState(state: unknown, _title: string, url?: unknown): void {
		this.calls.push("push");
		this.urls.push(url);
		this.entries.splice(this.index + 1);
		this.entries.push(structuredClone(state));
		this.index++;
	}
	replaceState(state: unknown, _title: string, url?: unknown): void {
		this.calls.push("replace");
		this.urls.push(url);
		this.entries[this.index] = structuredClone(state);
	}
	back(): void {
		this.calls.push("back");
	}
	/** The browser moved (its Back button, or a back() that landed). */
	pop(delta = -1): void {
		this.index += delta;
		this.window.dispatch("popstate");
	}
}

class FakeDialog extends Target {
	open = false;
	isConnected = true;
	/** A browser queues the `close` event as a task: it comes after close() returns. */
	deferClose = false;
	#queued = 0;
	showModal(): void {
		this.open = true;
	}
	close(): void {
		if (!this.open) return;
		this.open = false;
		if (this.deferClose) this.#queued++;
		else this.dispatch("close");
	}
	/** The queued `close` events run. */
	deliverClose(): void {
		while (this.#queued > 0) {
			this.#queued--;
			this.dispatch("close");
		}
	}
}

const ROUTER_STATE = { key: "k1", __TSR_key: "k1", __TSR_index: 3 };

let loads = 0;

/** A page with two photo dialogs, loaded on a history entry that has this state. */
async function page(state: unknown = ROUTER_STATE) {
	const window = new FakeWindow();
	const history = new FakeHistory(window, structuredClone(state));
	// TanStack replaces the instance's own methods; the viewer must not use them.
	const wrapper = () => {
		throw new Error("the router's wrapper was used");
	};
	Object.assign(history, { pushState: wrapper, replaceState: wrapper });
	window.history = history;
	const dialogs: Record<string, FakeDialog> = {
		"work-photo-1": new FakeDialog(),
		"work-photo-2": new FakeDialog(),
	};
	globals.window = window;
	globals.History = FakeHistory;
	globals.HTMLDialogElement = FakeDialog;
	globals.document = {
		getElementById: (id: string) => dialogs[id] ?? null,
	};
	const loaded = (await import(
		`../../src/studio/lightbox.ts?load=${++loads}`
	)) as typeof Lightbox;
	return { window, history, dialogs, showPhoto: loaded.showPhoto, loaded };
}

describe("Back closes the work photo viewer (TAT-123)", () => {
	test("opening a photo adds one entry at the same address with the router's own state", async () => {
		const { history, dialogs, showPhoto } = await page();

		showPhoto("work-photo-1");

		assert.ok(dialogs["work-photo-1"].open);
		assert.deepEqual(history.calls, ["push"]);
		assert.deepEqual(
			history.urls,
			[undefined],
			"no URL: the address never changes",
		);
		assert.deepEqual(history.state, {
			...ROUTER_STATE,
			[PHOTO_ENTRY]: "work-photo-1",
		});
		assert.equal(PHOTO_ENTRY, "tattooDripPhoto");
	});

	test("Back closes the photo and takes nothing more off", async () => {
		const { window, history, dialogs, showPhoto } = await page();
		showPhoto("work-photo-1");

		history.pop();

		assert.equal(dialogs["work-photo-1"].open, false);
		assert.deepEqual(history.calls, ["push"], "no back() of its own");
		assert.equal(window.count("popstate"), 0);
		assert.equal(dialogs["work-photo-1"].count("close"), 0);
		assert.deepEqual(history.state, ROUTER_STATE);
	});

	test("Close or Escape takes the entry off with one back(); a photo clicked before it lands waits", async () => {
		const { window, history, dialogs, showPhoto } = await page();
		showPhoto("work-photo-1");

		dialogs["work-photo-1"].close();
		assert.deepEqual(history.calls, ["push", "back"]);

		showPhoto("work-photo-2");
		assert.equal(dialogs["work-photo-2"].open, false, "it waits for the back");
		assert.deepEqual(history.calls, ["push", "back"]);

		history.pop();
		assert.equal(window.count("popstate"), 0, "no listener is left");
		assert.deepEqual(history.state, ROUTER_STATE);

		showPhoto("work-photo-2");
		assert.ok(dialogs["work-photo-2"].open);
		assert.deepEqual(history.calls, ["push", "back", "push"]);
		assert.deepEqual(history.state, {
			...ROUTER_STATE,
			[PHOTO_ENTRY]: "work-photo-2",
		});
	});

	test("a slow back() keeps the viewer shut until its popstate: reopening and closing meanwhile queue no second traversal", async () => {
		const { window, history, dialogs, showPhoto } = await page();
		mock.timers.enable({ apis: ["setTimeout"] });
		showPhoto("work-photo-1");
		dialogs["work-photo-1"].close();
		assert.deepEqual(history.calls, ["push", "back"]);

		// The browser is slow to move: time passing, taps and Escapes change nothing.
		mock.timers.tick(60_000);
		for (let tap = 0; tap < 5; tap++) {
			showPhoto("work-photo-1");
			showPhoto("work-photo-2");
		}
		assert.equal(dialogs["work-photo-1"].open, false);
		assert.equal(dialogs["work-photo-2"].open, false);
		assert.deepEqual(history.calls, ["push", "back"], "still the one back()");
		assert.equal(window.count("popstate"), 1, "still waiting for the move");

		history.pop(); // it lands at last
		assert.equal(window.count("popstate"), 0);
		assert.deepEqual(history.state, ROUTER_STATE);
		assert.deepEqual(history.calls, ["push", "back"]);
	});

	test("after the delayed popstate a photo opens and closes again, one back() each time", async () => {
		const { history, dialogs, showPhoto } = await page();
		for (const id of ["work-photo-1", "work-photo-2", "work-photo-1"]) {
			showPhoto(id);
			assert.ok(dialogs[id].open, `${id} opens`);
			dialogs[id].close();
			showPhoto(id); // too early
			assert.equal(dialogs[id].open, false);
			history.pop();
			assert.deepEqual(history.state, ROUTER_STATE);
		}

		assert.deepEqual(history.calls, [
			"push",
			"back",
			"push",
			"back",
			"push",
			"back",
		]);
		assert.equal(history.index, 0, "back on the page's own entry");
		assert.equal(
			history.entries.length,
			2,
			"each push replaced the forward entry",
		);
	});

	test("a photo reopened before its close event is delivered starts no second traversal", async () => {
		const { history, dialogs, showPhoto } = await page();
		const dialog = dialogs["work-photo-1"];
		dialog.deferClose = true;
		showPhoto("work-photo-1");

		dialog.close(); // open is false at once; the close event is queued
		showPhoto("work-photo-1");
		assert.equal(dialog.open, false, "the viewer session is still guarded");
		assert.deepEqual(history.calls, ["push"], "no second entry");
		assert.equal(dialog.count("close"), 1, "one handler, not two");

		dialog.deliverClose();
		assert.deepEqual(history.calls, ["push", "back"], "exactly one back()");
		showPhoto("work-photo-1");
		showPhoto("work-photo-2");
		assert.equal(dialog.open, false, "guarded until the real popstate");
		assert.equal(dialogs["work-photo-2"].open, false);

		history.pop();
		showPhoto("work-photo-1");
		assert.ok(dialog.open, "it opens after the pop");
		assert.deepEqual(history.calls, ["push", "back", "push"]);
	});

	test("Back, then the same photo again before the close event is delivered: no back() at all", async () => {
		const { window, history, dialogs, showPhoto } = await page();
		const dialog = dialogs["work-photo-1"];
		dialog.deferClose = true;
		showPhoto("work-photo-1");

		history.pop(); // Back closes the dialog; its close event is queued
		assert.equal(dialog.open, false);
		showPhoto("work-photo-1");
		assert.equal(dialog.open, false, "guarded until the close event ran");
		assert.deepEqual(history.calls, ["push"]);

		dialog.deliverClose();
		assert.deepEqual(
			history.calls,
			["push"],
			"Back already took the entry off",
		);
		assert.equal(window.count("popstate"), 0);
		assert.equal(dialog.count("close"), 0);

		showPhoto("work-photo-1");
		assert.ok(dialog.open);
		assert.deepEqual(history.calls, ["push", "push"]);
	});

	test("a photo's dialog that left the page while open does not keep the viewer shut", async () => {
		const { window, history, dialogs, showPhoto } = await page();
		showPhoto("work-photo-1");
		dialogs["work-photo-1"].isConnected = false; // the route changed under it

		showPhoto("work-photo-2");

		assert.ok(dialogs["work-photo-2"].open);
		assert.equal(window.count("popstate"), 1, "only the new photo listens");
		assert.equal(dialogs["work-photo-1"].count("close"), 0);
		assert.deepEqual(history.calls, ["push", "replace"]);
	});

	test("there is no timer: nothing is scheduled, and nothing is exported to wait for", async () => {
		const timers = globals.setTimeout;
		globals.setTimeout = () => {
			throw new Error("the viewer scheduled a timer");
		};
		try {
			const { dialogs, history, loaded, showPhoto } = await page();
			showPhoto("work-photo-1");
			dialogs["work-photo-1"].close();
			showPhoto("work-photo-2");
			history.pop();
			assert.equal("LEAVE_WAIT_MS" in loaded, false);
		} finally {
			globals.setTimeout = timers;
		}
	});

	test("a page loaded on a marked entry (a reload with a photo open) takes the marker off, keeping the router's state", async () => {
		const { window, history, dialogs } = await page({
			...ROUTER_STATE,
			[PHOTO_ENTRY]: "work-photo-1",
		});

		assert.deepEqual(history.calls, ["replace"], "the browser's own, once");
		assert.deepEqual(history.urls, [undefined], "no URL: the address stays");
		assert.deepEqual(history.state, ROUTER_STATE);
		assert.equal(history.entries.length, 1);
		assert.equal(dialogs["work-photo-1"].open, false);
		assert.equal(window.count("popstate"), 0);
	});

	test("a page loaded on an unmarked entry, or on a state that is not an object, is left alone", async () => {
		for (const state of [ROUTER_STATE, null, "x", 5, ["a"]]) {
			const { history } = await page(state);

			assert.deepEqual(history.calls, [], String(state));
			assert.deepEqual(history.state, state);
		}
	});

	test("a duplicated tab (one marked entry, nothing before it): Close does not lock the viewer", async () => {
		const { window, history, dialogs, showPhoto } = await page({
			...ROUTER_STATE,
			[PHOTO_ENTRY]: "work-photo-1",
		});
		assert.deepEqual(history.state, ROUTER_STATE, "the leftover is gone");

		showPhoto("work-photo-2");
		assert.deepEqual(history.calls, ["replace", "push"], "a new entry");
		assert.equal(history.entries.length, 2, "so Close has an entry before it");
		dialogs["work-photo-2"].close();
		assert.deepEqual(history.calls, ["replace", "push", "back"]);
		history.pop();
		assert.equal(window.count("popstate"), 0);

		showPhoto("work-photo-1");
		assert.ok(dialogs["work-photo-1"].open, "opens again without a reload");
		history.pop();
		assert.equal(dialogs["work-photo-1"].open, false, "Back still closes it");
	});

	test("an entry the browser's Forward returned to, still marked, is reused, not stacked", async () => {
		const { history, dialogs, showPhoto } = await page();
		showPhoto("work-photo-1");
		history.pop(); // Back: closed
		history.pop(1); // Forward: the marked entry again, nothing open

		showPhoto("work-photo-2");

		assert.ok(dialogs["work-photo-2"].open);
		assert.deepEqual(history.calls, ["push", "replace"]);
		assert.deepEqual(history.urls, [undefined, undefined]);
		assert.equal(history.entries.length, 2);
		assert.deepEqual(history.state, {
			...ROUTER_STATE,
			[PHOTO_ENTRY]: "work-photo-2",
		});
	});

	test("an open photo is not opened or pushed again", async () => {
		const { history, showPhoto } = await page();

		showPhoto("work-photo-1");
		showPhoto("work-photo-1");

		assert.deepEqual(history.calls, ["push"]);
	});

	test("a close after the entry is no longer current calls no back()", async () => {
		const { window, history, dialogs, showPhoto } = await page();
		showPhoto("work-photo-1");
		history.index = 0; // the browser moved on without a popstate reaching the viewer

		dialogs["work-photo-1"].close();

		assert.deepEqual(history.calls, ["push"]);
		assert.equal(window.count("popstate"), 0);
		assert.equal(dialogs["work-photo-1"].count("close"), 0);
	});

	test("Back, then the same photo again, opens it with a new entry", async () => {
		const { history, dialogs, showPhoto } = await page();
		showPhoto("work-photo-1");
		history.pop();

		showPhoto("work-photo-1");

		assert.ok(dialogs["work-photo-1"].open);
		assert.deepEqual(history.calls, ["push", "push"]);
	});

	test("history state that is not an object is treated as the router's empty state", async () => {
		for (const state of [null, "x", 5, ["a"]]) {
			const { history, showPhoto } = await page(state);

			showPhoto("work-photo-1");

			assert.deepEqual(history.calls, ["push"], String(state));
			assert.deepEqual(history.state, { [PHOTO_ENTRY]: "work-photo-1" });
		}
	});

	test("without <dialog> the large photo opens and no entry is added", async () => {
		const { window, history, showPhoto } = await page();
		delete globals.HTMLDialogElement;
		globals.document = {
			getElementById: () => ({
				querySelector: () => ({ src: "https://api.example.com/w.1280w.jpg" }),
			}),
		};

		showPhoto("work-photo-1");

		assert.deepEqual(history.calls, []);
		assert.deepEqual(window.assigned, ["https://api.example.com/w.1280w.jpg"]);
		assert.equal(window.count("popstate"), 0);
	});
});
