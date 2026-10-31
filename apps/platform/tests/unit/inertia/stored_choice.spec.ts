import { test } from "@japa/runner";
import { JSDOM } from "jsdom";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `ChoiceModule` below restates its shape and the inertia project type-checks the real one.
import * as choiceModule from "../../../inertia/components/stored_choice.js";

type Row = { key: string; shown: boolean };
type ChoiceModule = {
	useStoredChoice<T extends string>(stored: T): [T, (next: string) => void];
	useStoredRows(
		stored: readonly string[],
		all: readonly string[],
	): [Row[], (rows: Row[]) => void];
};
const { useStoredChoice, useStoredRows } = choiceModule as ChoiceModule;

// The hooks behind Page look's radio groups (TAT-56 fix round 4) and its sections list
// (TAT-126), in a DOM: each shows the stored value, keeps the owner's pick while the stored
// value is unchanged (typing, a refused save) and follows it when it changes (this save
// landed, or another tab saved).
test.group("useStoredChoice and useStoredRows in a DOM (TAT-56)", (group) => {
	let dom: JSDOM;
	let react: typeof import("react");
	let client: typeof import("react-dom/client");
	let act: (work: () => void | Promise<void>) => Promise<void>;
	const globals = [
		"window",
		"document",
		"HTMLElement",
		"Node",
		"Event",
		"IS_REACT_ACT_ENVIRONMENT",
	];
	const saved = new Map<string, PropertyDescriptor | undefined>();

	group.setup(async () => {
		dom = new JSDOM("<!doctype html><div id=root></div>", {
			pretendToBeVisual: true,
		});
		const { window } = dom;
		for (const name of globals) {
			saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		}
		Object.assign(globalThis, {
			window,
			document: window.document,
			HTMLElement: window.HTMLElement,
			Node: window.Node,
			Event: window.Event,
			IS_REACT_ACT_ENVIRONMENT: true,
		});
		react = await import("react");
		client = await import("react-dom/client");
		act = react.act as typeof act;
	});

	group.teardown(() => {
		for (const name of globals) {
			const before = saved.get(name);
			if (before) Object.defineProperty(globalThis, name, before);
			else delete (globalThis as Record<string, unknown>)[name];
		}
		dom.window.close();
	});

	/** A new container for each mount: React warns when a container is passed to createRoot twice. */
	function freshHost(): HTMLElement {
		const host = dom.window.document.createElement("div");
		dom.window.document.body.append(host);
		return host;
	}

	function mount() {
		let latest: [string, (next: string) => void] | undefined;
		function Group({ stored }: { stored: string }) {
			latest = useStoredChoice(stored);
			return null;
		}
		const root = client.createRoot(freshHost());
		return {
			render: (stored: string) =>
				act(() => root.render(react.createElement(Group, { stored }))),
			shown: () => (latest as [string, unknown])[0],
			pick: (next: string) =>
				act(() => (latest as [string, (next: string) => void])[1](next)),
		};
	}

	test("starts on the stored value", async ({ assert }) => {
		const choice = mount();
		await choice.render("eczar");
		assert.equal(choice.shown(), "eczar");
	});

	test("keeps the owner's pick while the stored value is the same (typing, a refused save)", async ({
		assert,
	}) => {
		const choice = mount();
		await choice.render("eczar");
		await choice.pick("sans");
		assert.equal(choice.shown(), "sans");
		await choice.render("eczar");
		assert.equal(
			choice.shown(),
			"sans",
			"the same stored value: the pick stays",
		);
	});

	test("follows a changed stored value, with no remount", async ({
		assert,
	}) => {
		const choice = mount();
		await choice.render("eczar");
		await choice.pick("sans");
		// Another tab saved the serif; this page gets the fresh look (a logo removed here).
		await choice.render("serif");
		assert.equal(
			choice.shown(),
			"serif",
			"the stored value won over the old pick",
		);
		// And a pick after that sticks again until the stored value changes.
		await choice.pick("sans");
		await choice.render("serif");
		assert.equal(choice.shown(), "sans");
	});

	test("a save that lands shows the saved value", async ({ assert }) => {
		const choice = mount();
		await choice.render("eczar");
		await choice.pick("sans");
		await choice.render("sans");
		assert.equal(choice.shown(), "sans");
		await choice.render("sans");
		assert.equal(choice.shown(), "sans");
	});

	function mountRows() {
		let latest: [Row[], (rows: Row[]) => void] | undefined;
		function List({ stored }: { stored: string[] }) {
			latest = useStoredRows(stored, ["work", "artists", "inquiry"]);
			return null;
		}
		const root = client.createRoot(freshHost());
		return {
			render: (stored: string[]) =>
				act(() => root.render(react.createElement(List, { stored }))),
			shown: () => (latest as [Row[], unknown])[0],
			keys: () => (latest as [Row[], unknown])[0].map((row) => row.key),
			set: (rows: Row[]) =>
				act(() => (latest as [unknown, (rows: Row[]) => void])[1](rows)),
		};
	}

	test("rows start as the stored sections, then the hidden ones", async ({
		assert,
	}) => {
		const rows = mountRows();
		await rows.render(["artists", "inquiry"]);
		assert.deepEqual(rows.shown(), [
			{ key: "artists", shown: true },
			{ key: "inquiry", shown: true },
			{ key: "work", shown: false },
		]);
	});

	test("rows keep the owner's changes while the stored list is the same (a move, a refused save, a render)", async ({
		assert,
	}) => {
		const rows = mountRows();
		await rows.render(["artists", "inquiry"]);
		await rows.set([
			{ key: "inquiry", shown: true },
			{ key: "work", shown: true },
			{ key: "artists", shown: false },
		]);
		assert.deepEqual(rows.keys(), ["inquiry", "work", "artists"]);
		// A new array with the same sections is the same stored list.
		await rows.render(["artists", "inquiry"]);
		assert.deepEqual(rows.keys(), ["inquiry", "work", "artists"]);
	});

	test("rows follow a changed stored list in place, with no remount", async ({
		assert,
	}) => {
		const rows = mountRows();
		await rows.render(["artists", "inquiry"]);
		await rows.set([
			{ key: "inquiry", shown: true },
			{ key: "work", shown: true },
			{ key: "artists", shown: false },
		]);
		// Another tab saved work, artists, the form; this page gets the fresh look.
		await rows.render(["work", "artists", "inquiry"]);
		assert.deepEqual(rows.shown(), [
			{ key: "work", shown: true },
			{ key: "artists", shown: true },
			{ key: "inquiry", shown: true },
		]);
		// And a change after that sticks again until the stored list changes.
		await rows.set([
			{ key: "artists", shown: true },
			{ key: "work", shown: true },
			{ key: "inquiry", shown: true },
		]);
		await rows.render(["work", "artists", "inquiry"]);
		assert.deepEqual(rows.keys(), ["artists", "work", "inquiry"]);
	});

	test("a save that lands shows the saved order", async ({ assert }) => {
		const rows = mountRows();
		await rows.render(["work", "artists", "inquiry"]);
		await rows.set([
			{ key: "artists", shown: true },
			{ key: "work", shown: true },
			{ key: "inquiry", shown: true },
		]);
		await rows.render(["artists", "work", "inquiry"]);
		assert.deepEqual(rows.keys(), ["artists", "work", "inquiry"]);
		await rows.render(["artists", "work", "inquiry"]);
		assert.deepEqual(rows.keys(), ["artists", "work", "inquiry"]);
	});
});
