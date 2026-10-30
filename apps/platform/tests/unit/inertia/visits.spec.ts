import { test } from "@japa/runner";
import { JSDOM } from "jsdom";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `VisitsModule` below restates its shape and the inertia project type-checks the real one.
import * as visitsModule from "../../../inertia/components/visits.js";

// The events have the shapes Inertia 3.8 fires (core/dist/index.js): `start` and `finish` carry
// `detail.visit` (the visit's own object, with its `id`, `method` and `url`), `error` carries
// `detail.visitId`, and `networkError` carries only `detail.error`.
type Detail = {
	visit?: { id?: string; method?: string; url?: URL };
	visitId?: string;
	errors?: Record<string, string>;
	error?: unknown;
};
type Callback = (event: { detail: Detail }) => boolean | undefined;
type VisitsModule = {
	PAGE_LOST: string;
	SAVE_LOST: string;
	connectionLostText(method: string): string;
	watchVisits(
		on: (type: string, callback: Callback) => () => void,
		doc: Document,
		notify: (text: string) => void,
		isNetworkError: (error: unknown) => boolean,
	): () => void;
	firstInvalidField(scope: ParentNode | null): HTMLElement | null;
	focusField(field: HTMLElement | null): void;
};
const {
	PAGE_LOST,
	SAVE_LOST,
	connectionLostText,
	watchVisits,
	firstInvalidField,
	focusField,
} = visitsModule as VisitsModule;

/** What `app.tsx` passes: Inertia's `HttpNetworkError`, here a stand-in with its `url`. */
class NetworkError extends Error {
	constructor(readonly url?: string) {
		super("Network error");
	}
}
const isNetworkError = (error: unknown) => error instanceof NetworkError;

const href = (path: string) => `http://localhost:3401${path}`;

/** A fake of Inertia's `router.on`: it keeps each callback by event type and returns its remover. */
function fakeRouter() {
	const callbacks = new Map<string, Callback>();
	const fire = (type: string, detail: Detail) =>
		callbacks.get(type)?.({ detail });
	return {
		callbacks,
		on(type: string, callback: Callback) {
			callbacks.set(type, callback);
			return () => {
				callbacks.delete(type);
			};
		},
		start: (id: string, method = "post", path = `/visits/${id}`) =>
			fire("start", { visit: { id, method, url: new URL(href(path)) } }),
		refuse: (id: string) =>
			fire("error", { errors: { field: "wrong" }, visitId: id }),
		lose: (url?: string) =>
			fire("networkError", { error: new NetworkError(url) }),
		crash: () => fire("networkError", { error: new Error("boom") }),
		finish: (id: string, method = "post", path = `/visits/${id}`) =>
			fire("finish", { visit: { id, method, url: new URL(href(path)) } }),
	};
}

function documentOf(html = "<body></body>") {
	return new JSDOM(html).window.document;
}

/** The module watching a fake router, and the toasts it raised. */
function watched() {
	const router = fakeRouter();
	const toasts: string[] = [];
	const stop = watchVisits(
		router.on,
		documentOf(),
		(text) => toasts.push(text),
		isNetworkError,
	);
	return { router, toasts, stop };
}

test.group("A lost connection (TAT-84)", () => {
	test("a page load that died says to check the connection", ({ assert }) => {
		assert.equal(connectionLostText("get"), PAGE_LOST);
		assert.equal(connectionLostText("GET"), PAGE_LOST);
	});

	test("a save that died says to look before trying again", ({ assert }) => {
		for (const method of ["post", "put", "patch", "delete"]) {
			assert.equal(connectionLostText(method), SAVE_LOST);
		}
	});

	test("both texts are plain words", ({ assert }) => {
		for (const text of [PAGE_LOST, SAVE_LOST]) {
			assert.notMatch(text, /network|request|server|error|http/i);
		}
	});

	test("a save that died never offers a blind retry", ({ assert }) => {
		assert.match(SAVE_LOST, /Open the page again to see whether it saved/);
	});

	test("a network error is answered with false, so Inertia does not reject the visit", ({
		assert,
	}) => {
		const { router } = watched();
		assert.isFalse(router.lose(href("/x")));
	});

	test("the toast comes at the visit's end, once, with the words for its method", ({
		assert,
	}) => {
		const { router, toasts } = watched();

		router.start("g", "get", "/projects");
		router.lose(href("/projects"));
		router.finish("g", "get", "/projects");
		assert.deepEqual(toasts, [PAGE_LOST]);

		router.finish("g", "get", "/projects");
		assert.deepEqual(toasts, [PAGE_LOST], "the entry is used up by a toast");

		router.start("p", "post", "/notes");
		router.lose(href("/notes"));
		router.finish("p", "post", "/notes");
		assert.deepEqual(toasts, [PAGE_LOST, SAVE_LOST]);
	});

	test("an error that is not the network's gets no toast and is not cancelled", ({
		assert,
	}) => {
		// Inertia 3.8 hands `networkError` any exception thrown while it handles an answer
		// (resolving a component, an onSuccess callback), not only a lost connection.
		const { router, toasts } = watched();
		router.start("p");
		assert.isUndefined(router.crash());
		router.finish("p");
		assert.deepEqual(toasts, []);
	});

	test("a visit that finishes without a network error says nothing", ({
		assert,
	}) => {
		const { router, toasts } = watched();
		router.start("a", "post");
		router.finish("a", "post");
		router.start("b", "get");
		router.finish("b", "get");
		assert.deepEqual(toasts, []);
	});

	test("another visit finishing first neither takes the toast nor gets it", ({
		assert,
	}) => {
		const { router, toasts } = watched();
		router.start("save", "post", "/notes");
		router.start("page", "get", "/projects");
		router.lose(href("/notes"));
		router.finish("page", "get", "/projects");
		assert.deepEqual(toasts, [], "the page load did not fail");
		router.finish("save", "post", "/notes");
		assert.deepEqual(toasts, [SAVE_LOST]);
	});

	test("two lost visits each get the words for their own method", ({
		assert,
	}) => {
		const { router, toasts } = watched();
		router.start("save", "post", "/notes");
		router.start("page", "get", "/projects");
		router.lose(href("/notes"));
		router.lose(href("/projects"));
		router.finish("page", "get", "/projects");
		router.finish("save", "post", "/notes");
		assert.deepEqual(toasts, [PAGE_LOST, SAVE_LOST]);
	});

	test("an error that names no address still gets its toast at the next finish", ({
		assert,
	}) => {
		const { router, toasts } = watched();
		router.start("save", "post", "/notes");
		router.lose();
		router.finish("save", "post", "/notes");
		assert.deepEqual(toasts, [SAVE_LOST]);
	});

	test("the returned function removes every callback", ({ assert }) => {
		const { router, stop } = watched();
		assert.isAbove(router.callbacks.size, 0);
		stop();
		assert.equal(router.callbacks.size, 0);
	});
});

/**
 * Form B comes FIRST in the document with an invalid input; form A, the one that is sent, holds a
 * plain input, a radio group marked invalid (its second choice checked) and an invalid input.
 */
const FORMS = `<body>
	<form id="b"><input id="b-name" aria-invalid="true" /></form>
	<form id="a">
		<input id="a-plain" />
		<div id="a-group" role="radiogroup" aria-invalid="true">
			<button type="button" role="radio" id="a-first" aria-checked="false"></button>
			<button type="button" role="radio" id="a-second" aria-checked="true"></button>
		</div>
		<input id="a-name" aria-invalid="true" />
	</form>
</body>`;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
	const window = new JSDOM(FORMS).window;
	const doc = window.document;
	const scrolled: Array<[Element, unknown]> = [];
	window.HTMLElement.prototype.scrollIntoView = function (
		this: Element,
		options?: unknown,
	) {
		scrolled.push([this, options]);
	};
	const router = fakeRouter();
	const stop = watchVisits(router.on, doc, () => {}, isNetworkError);
	const send = (id: string) =>
		doc
			.getElementById(id)
			?.dispatchEvent(
				new window.Event("submit", { bubbles: true, cancelable: true }),
			);
	return { window, doc, router, scrolled, stop, send };
}

test.group("Focus after a refused form (TAT-84)", () => {
	test("the form that was sent wins: its radio group's checked choice gets focus, scrolled to the middle", async ({
		assert,
	}) => {
		const { doc, router, scrolled, send } = setup();
		send("a");
		router.start("v1");
		router.refuse("v1");
		router.finish("v1");
		await tick();
		assert.equal(doc.activeElement?.id, "a-second");
		assert.lengthOf(scrolled, 1);
		assert.equal(scrolled[0][0].id, "a-second");
		assert.deepEqual(scrolled[0][1], { block: "center" });
	});

	test("firstInvalidField takes the first marked control of a scope", ({
		assert,
	}) => {
		const { doc } = setup();
		assert.equal(firstInvalidField(doc.getElementById("b"))?.id, "b-name");
		assert.equal(firstInvalidField(doc.getElementById("a"))?.id, "a-second");
	});

	test("a group with no checked choice gives its first control", ({
		assert,
	}) => {
		const { doc } = setup();
		doc.getElementById("a-second")?.setAttribute("aria-checked", "false");
		assert.equal(firstInvalidField(doc.getElementById("a"))?.id, "a-first");
	});

	test("nothing marked, or no scope, gives null", ({ assert }) => {
		const { doc } = setup();
		assert.isNull(firstInvalidField(null));
		doc.getElementById("a-name")?.removeAttribute("aria-invalid");
		doc.getElementById("a-group")?.removeAttribute("aria-invalid");
		assert.isNull(firstInvalidField(doc.getElementById("a")));
	});

	test("focusField with nothing does nothing", ({ assert }) => {
		assert.doesNotThrow(() => focusField(null));
	});

	test("an answer with field errors but no submit before it moves nothing", async ({
		assert,
	}) => {
		const { doc, router, scrolled } = setup();
		router.start("v1");
		router.refuse("v1");
		router.finish("v1");
		await tick();
		assert.equal(doc.activeElement, doc.body);
		assert.lengthOf(scrolled, 0);
	});

	test("a form removed before the answer cannot take focus", async ({
		assert,
	}) => {
		const { doc, router, scrolled, send } = setup();
		const form = doc.getElementById("a");
		send("a");
		router.start("v1");
		form?.remove();
		router.refuse("v1");
		assert.doesNotThrow(() => router.finish("v1"));
		await tick();
		assert.notEqual(doc.activeElement?.id, "a-second");
		assert.lengthOf(scrolled, 0);
	});

	test("a saved form (no field errors) moves nothing", async ({ assert }) => {
		const { doc, router, scrolled, send } = setup();
		send("a");
		router.start("v1");
		router.finish("v1");
		await tick();
		assert.notEqual(doc.activeElement?.id, "a-second");
		assert.lengthOf(scrolled, 0);
	});

	test("the form is forgotten at its visit's end", async ({ assert }) => {
		const { doc, router, scrolled, send } = setup();
		send("a");
		router.start("v1");
		router.finish("v1");
		router.start("v2");
		router.refuse("v2");
		router.finish("v2");
		await tick();
		assert.notEqual(doc.activeElement?.id, "a-second");
		assert.lengthOf(scrolled, 0);
	});

	test("a visit that interrupts another keeps its own form: the old visit's finish does not wipe it", async ({
		assert,
	}) => {
		// Form A is out; form B is submitted. Inertia's order: submit, before, the old visit is
		// interrupted (its finish fires at once), then the new visit starts.
		const { doc, router, scrolled, send } = setup();
		send("a");
		router.start("v1");
		send("b");
		router.finish("v1");
		router.start("v2");
		router.refuse("v2");
		router.finish("v2");
		await tick();
		assert.equal(doc.activeElement?.id, "b-name");
		assert.lengthOf(scrolled, 1);
	});

	test("an interrupted visit's answer never focuses anything", async ({
		assert,
	}) => {
		const { doc, router, scrolled, send } = setup();
		send("a");
		router.start("v1");
		send("b");
		router.finish("v1");
		router.start("v2");
		router.finish("v2");
		await tick();
		assert.equal(doc.activeElement, doc.body);
		assert.lengthOf(scrolled, 0);
	});

	test("an async visit finishing while a form's request is out does not wipe the form", async ({
		assert,
	}) => {
		// The notes save is async: it starts before form A is sent and finishes while A is out.
		const { doc, router, send } = setup();
		router.start("notes", "put", "/notes");
		send("a");
		router.start("v1");
		router.finish("notes", "put", "/notes");
		router.refuse("v1");
		router.finish("v1");
		await tick();
		assert.equal(doc.activeElement?.id, "a-second");
	});

	test("another visit's refusal, finishing first, does not focus a form that was not refused", async ({
		assert,
	}) => {
		const { doc, router, scrolled, send } = setup();
		router.start("button", "post", "/moves");
		send("a");
		router.start("v1");
		router.refuse("button");
		router.finish("button", "post", "/moves");
		router.finish("v1");
		await tick();
		assert.equal(doc.activeElement, doc.body);
		assert.lengthOf(scrolled, 0);
	});

	test("a submit that never starts a visit cannot bind to a later, unrelated one", async ({
		assert,
	}) => {
		const { doc, router, scrolled, send } = setup();
		send("a");
		await tick();
		router.start("later", "post", "/moves");
		router.refuse("later");
		router.finish("later", "post", "/moves");
		await tick();
		assert.equal(doc.activeElement, doc.body);
		assert.lengthOf(scrolled, 0);
	});

	test("the cleanup removes the submit listener", ({ assert }) => {
		const { doc, stop } = setup();
		const calls: unknown[][] = [];
		const remove = doc.removeEventListener.bind(doc);
		doc.removeEventListener = ((...args: unknown[]) => {
			calls.push(args);
			// biome-ignore lint/suspicious/noExplicitAny: forwards to the real method
			return (remove as any)(...args);
		}) as typeof doc.removeEventListener;
		stop();
		assert.lengthOf(calls, 1);
		assert.equal(calls[0][0], "submit");
		assert.typeOf(calls[0][1], "function");
		assert.isTrue(calls[0][2]);
	});
});
