import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
	TURNSTILE_READY_CALLBACK,
	TURNSTILE_SCRIPT_URL,
	type TurnstileApi,
} from "../../src/intake/challenge.ts";
import { browserChallengeHost } from "../../src/intake/challenge-host.ts";

/*
 * browserChallengeHost() touches the page's window and document, which node
 * doesn't have: a few stand-ins, put in place for each test and removed
 * after. What they pin is how the script tag is shared between form mounts
 * (the studio page and an artist's page both mount the form, and the router
 * moves between them without reloading).
 */

type Listener = () => void;

interface FakeScript {
	src: string;
	async: boolean;
	removed: boolean;
	listeners: Map<string, Listener>;
	addEventListener(type: string, listener: Listener): void;
	remove(): void;
}

let appended: FakeScript[] = [];
let page: Record<string, unknown> = {};

function install(): void {
	appended = [];
	page = {};
	const document = {
		createElement: (): FakeScript => {
			const script: FakeScript = {
				src: "",
				async: false,
				removed: false,
				listeners: new Map(),
				addEventListener: (type, listener) =>
					script.listeners.set(type, listener),
				remove: () => {
					script.removed = true;
				},
			};
			return script;
		},
		head: { append: (script: FakeScript) => appended.push(script) },
	};
	Object.assign(globalThis, { window: page, document });
}

function uninstall(): void {
	Reflect.deleteProperty(globalThis, "window");
	Reflect.deleteProperty(globalThis, "document");
}

const counter = () => {
	const calls = { ready: 0, failed: 0 };
	return {
		calls,
		ready: () => {
			calls.ready += 1;
		},
		failed: () => {
			calls.failed += 1;
		},
	};
};

const cloudflareArrives = () => {
	page.turnstile = {} as TurnstileApi;
	(page[TURNSTILE_READY_CALLBACK] as Listener)();
};

describe("browserChallengeHost().loadScript", () => {
	beforeEach(install);
	afterEach(uninstall);

	test("adds Cloudflare's script, async, and reports ready when it calls back", () => {
		const first = counter();
		browserChallengeHost().loadScript(
			TURNSTILE_SCRIPT_URL,
			first.ready,
			first.failed,
		);

		assert.equal(appended.length, 1);
		assert.equal(appended[0].src, TURNSTILE_SCRIPT_URL);
		assert.equal(appended[0].async, true);
		assert.equal(first.calls.ready, 0);

		cloudflareArrives();

		assert.deepEqual(first.calls, { ready: 1, failed: 0 });
		assert.equal(
			TURNSTILE_READY_CALLBACK in page,
			false,
			"the global callback is gone",
		);
	});

	test("two form mounts share one script tag and both hear when it is ready", () => {
		const first = counter();
		const second = counter();
		browserChallengeHost().loadScript(
			TURNSTILE_SCRIPT_URL,
			first.ready,
			first.failed,
		);
		browserChallengeHost().loadScript(
			TURNSTILE_SCRIPT_URL,
			second.ready,
			second.failed,
		);

		assert.equal(appended.length, 1, "never a second tag");

		cloudflareArrives();

		assert.deepEqual(first.calls, { ready: 1, failed: 0 });
		assert.deepEqual(second.calls, { ready: 1, failed: 0 });
	});

	test("a mount after the script loaded is ready at once, with no new tag", () => {
		const first = counter();
		browserChallengeHost().loadScript(
			TURNSTILE_SCRIPT_URL,
			first.ready,
			first.failed,
		);
		cloudflareArrives();

		const later = counter();
		browserChallengeHost().loadScript(
			TURNSTILE_SCRIPT_URL,
			later.ready,
			later.failed,
		);

		assert.deepEqual(later.calls, { ready: 1, failed: 0 });
		assert.equal(appended.length, 1);
	});

	test("a script that can't load fails every waiting mount, and a later try adds a new tag", () => {
		const first = counter();
		const second = counter();
		browserChallengeHost().loadScript(
			TURNSTILE_SCRIPT_URL,
			first.ready,
			first.failed,
		);
		browserChallengeHost().loadScript(
			TURNSTILE_SCRIPT_URL,
			second.ready,
			second.failed,
		);

		appended[0].listeners.get("error")?.();

		assert.deepEqual(first.calls, { ready: 0, failed: 1 });
		assert.deepEqual(second.calls, { ready: 0, failed: 1 });
		assert.equal(appended[0].removed, true, "the dead tag is removed");
		assert.equal(TURNSTILE_READY_CALLBACK in page, false);

		const retry = counter();
		browserChallengeHost().loadScript(
			TURNSTILE_SCRIPT_URL,
			retry.ready,
			retry.failed,
		);
		assert.equal(appended.length, 2);
		cloudflareArrives();
		assert.deepEqual(retry.calls, { ready: 1, failed: 0 });
	});
});

describe("browserChallengeHost() the rest of the seam", () => {
	beforeEach(install);
	afterEach(uninstall);

	test("turnstile() is Cloudflare's global, once it exists", () => {
		const host = browserChallengeHost();
		assert.equal(host.turnstile(), undefined);

		const api = {} as TurnstileApi;
		page.turnstile = api;
		assert.equal(host.turnstile(), api);
	});

	test("setTimer runs on the window's timers and can be cancelled", () => {
		const started: Array<{ run: Listener; ms: number }> = [];
		const cleared: unknown[] = [];
		page.setTimeout = (run: Listener, ms: number) => {
			started.push({ run, ms });
			return 7;
		};
		page.clearTimeout = (handle: unknown) => cleared.push(handle);

		const cancel = browserChallengeHost().setTimer(() => {}, 20_000);
		assert.equal(started[0].ms, 20_000);
		cancel();
		assert.deepEqual(cleared, [7]);
	});
});
