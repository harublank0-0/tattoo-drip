import assert from "node:assert/strict";
import { afterEach, describe, mock, test } from "node:test";
import {
	LEAVE_WAIT_MS,
	PHOTO_ENTRY,
	showPhoto,
} from "../../src/studio/lightbox.ts";

/**
 * Back closes the work photo viewer (TAT-123). lightbox.ts reads the browser's
 * globals when showPhoto is called, so the browser is stood in by plain
 * objects: a window that keeps listeners, a session history that records what
 * was done to it, and dialogs that fire `close`. The instance's own
 * pushState / replaceState throw, as a stand-in for TanStack's wrappers: they
 * tell the router, which would run the page's loaders, so the viewer must go
 * through History.prototype, the browser's own.
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
	showModal(): void {
		this.open = true;
	}
	close(): void {
		if (!this.open) return;
		this.open = false;
		this.dispatch("close");
	}
}

const ROUTER_STATE = { key: "k1", __TSR_key: "k1", __TSR_index: 3 };

/** A page with two photo dialogs, on a history entry that has this state. */
function page(state: unknown = ROUTER_STATE) {
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
	return { window, history, dialogs };
}

describe("Back closes the work photo viewer (TAT-123)", () => {
	test("opening a photo adds one entry at the same address with the router's own state", () => {
		const { history, dialogs } = page();

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

	test("Back closes the photo and takes nothing more off", () => {
		const { window, history, dialogs } = page();
		showPhoto("work-photo-1");

		history.pop();

		assert.equal(dialogs["work-photo-1"].open, false);
		assert.deepEqual(history.calls, ["push"], "no back() of its own");
		assert.equal(window.count("popstate"), 0);
		assert.equal(dialogs["work-photo-1"].count("close"), 0);
		assert.deepEqual(history.state, ROUTER_STATE);
	});

	test("Close or Escape takes the entry off with one back(); a photo clicked before it lands waits", () => {
		const { window, history, dialogs } = page();
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

	test("a back() that moves nowhere (the marked entry is the session's first) does not lock the viewer", () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		const { window, history, dialogs } = page({
			...ROUTER_STATE,
			[PHOTO_ENTRY]: "work-photo-1",
		});
		showPhoto("work-photo-2"); // reuses the entry a duplicated tab carried over
		dialogs["work-photo-2"].close();
		assert.deepEqual(history.calls, ["replace", "back"]);

		showPhoto("work-photo-1");
		assert.equal(dialogs["work-photo-1"].open, false, "it waits for the back");

		// No popstate comes: there is no earlier entry to go back to.
		mock.timers.tick(LEAVE_WAIT_MS);
		assert.equal(window.count("popstate"), 0, "no listener is left");

		showPhoto("work-photo-1");
		assert.ok(
			dialogs["work-photo-1"].open,
			"a photo opens again without a reload",
		);
		assert.deepEqual(history.calls, ["replace", "back", "replace"]);
		assert.equal(history.entries.length, 1);
		assert.deepEqual(history.state, {
			...ROUTER_STATE,
			[PHOTO_ENTRY]: "work-photo-1",
		});
		history.pop(0);
		assert.equal(dialogs["work-photo-1"].open, false, "Back still closes it");
	});

	test("a back() that lands in time clears the wait, and the timeout does nothing later", () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		const { history, dialogs } = page();
		showPhoto("work-photo-1");
		dialogs["work-photo-1"].close();
		history.pop();

		showPhoto("work-photo-2");
		assert.ok(dialogs["work-photo-2"].open);
		mock.timers.tick(LEAVE_WAIT_MS * 2);
		assert.ok(dialogs["work-photo-2"].open, "the old timeout was cleared");
		assert.deepEqual(history.calls, ["push", "back", "push"]);
	});

	test("an open photo is not opened or pushed again", () => {
		const { history } = page();

		showPhoto("work-photo-1");
		showPhoto("work-photo-1");

		assert.deepEqual(history.calls, ["push"]);
	});

	test("an entry a reload left behind is reused, not stacked", () => {
		const { history, dialogs } = page({
			...ROUTER_STATE,
			[PHOTO_ENTRY]: "work-photo-1",
		});

		showPhoto("work-photo-2");

		assert.ok(dialogs["work-photo-2"].open);
		assert.deepEqual(history.calls, ["replace"]);
		assert.deepEqual(history.urls, [undefined]);
		assert.equal(history.entries.length, 1);
		assert.deepEqual(history.state, {
			...ROUTER_STATE,
			[PHOTO_ENTRY]: "work-photo-2",
		});
	});

	test("a close after the entry is no longer current calls no back()", () => {
		const { window, history, dialogs } = page();
		showPhoto("work-photo-1");
		history.index = 0; // the browser moved on without a popstate reaching the viewer

		dialogs["work-photo-1"].close();

		assert.deepEqual(history.calls, ["push"]);
		assert.equal(window.count("popstate"), 0);
		assert.equal(dialogs["work-photo-1"].count("close"), 0);
	});

	test("Back, then the same photo again, opens it with a new entry", () => {
		const { history, dialogs } = page();
		showPhoto("work-photo-1");
		history.pop();

		showPhoto("work-photo-1");

		assert.ok(dialogs["work-photo-1"].open);
		assert.deepEqual(history.calls, ["push", "push"]);
	});

	test("history state that is not an object is treated as the router's empty state", () => {
		for (const state of [null, "x", 5, ["a"]]) {
			const { history } = page(state);

			showPhoto("work-photo-1");

			assert.deepEqual(history.calls, ["push"], String(state));
			assert.deepEqual(history.state, { [PHOTO_ENTRY]: "work-photo-1" });
		}
	});

	test("without <dialog> the large photo opens and no entry is added", () => {
		const { window, history } = page();
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
