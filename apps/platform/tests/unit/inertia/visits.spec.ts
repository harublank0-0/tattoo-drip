import { test } from "@japa/runner";
import { JSDOM } from "jsdom";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `VisitsModule` below restates its shape and the inertia project type-checks the real one.
import * as visitsModule from "../../../inertia/components/visits.js";

type VisitEvent = { detail: { visit?: { method: string } } };
type Callback = (event: VisitEvent) => boolean | undefined;
type VisitsModule = {
	PAGE_LOST: string;
	SAVE_LOST: string;
	connectionLostText(method: string): string;
	watchVisits(
		on: (type: string, callback: Callback) => () => void,
		doc: Document,
		notify: (text: string) => void,
	): () => void;
};
const { PAGE_LOST, SAVE_LOST, connectionLostText, watchVisits } =
	visitsModule as VisitsModule;

/** A fake of Inertia's `router.on`: it keeps each callback by event type and returns its remover. */
function fakeRouter() {
	const callbacks = new Map<string, Callback>();
	return {
		callbacks,
		on(type: string, callback: Callback) {
			callbacks.set(type, callback);
			return () => {
				callbacks.delete(type);
			};
		},
		fire(type: string, method?: string) {
			return callbacks.get(type)?.({
				detail: { visit: method ? { method } : undefined },
			});
		},
	};
}

function documentOf(html = "<body></body>") {
	return new JSDOM(html).window.document;
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
		const router = fakeRouter();
		watchVisits(router.on, documentOf(), () => {});
		assert.isFalse(router.fire("networkError"));
	});

	test("the toast comes at the visit's end, once, with the words for its method", ({
		assert,
	}) => {
		const router = fakeRouter();
		const toasts: string[] = [];
		watchVisits(router.on, documentOf(), (text) => toasts.push(text));

		router.fire("networkError");
		router.fire("finish", "get");
		assert.deepEqual(toasts, [PAGE_LOST]);

		router.fire("finish", "get");
		assert.deepEqual(toasts, [PAGE_LOST], "the flag resets after a toast");

		router.fire("networkError");
		router.fire("finish", "post");
		assert.deepEqual(toasts, [PAGE_LOST, SAVE_LOST]);
	});

	test("a visit that finishes without a network error says nothing", ({
		assert,
	}) => {
		const router = fakeRouter();
		const toasts: string[] = [];
		watchVisits(router.on, documentOf(), (text) => toasts.push(text));
		router.fire("finish", "post");
		router.fire("finish", "get");
		assert.deepEqual(toasts, []);
	});

	test("the returned function removes every callback", ({ assert }) => {
		const router = fakeRouter();
		const stop = watchVisits(router.on, documentOf(), () => {});
		assert.isAbove(router.callbacks.size, 0);
		stop();
		assert.equal(router.callbacks.size, 0);
	});
});
