import { test } from "@japa/runner";
import { JSDOM } from "jsdom";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `ChoiceModule` below restates its shape and the inertia project type-checks the real one.
import * as choiceModule from "../../../inertia/components/stored_choice.js";

type ChoiceModule = {
	useStoredChoice<T extends string>(stored: T): [T, (next: string) => void];
};
const { useStoredChoice } = choiceModule as ChoiceModule;

// The hook behind Page look's radio groups (TAT-56 fix round 4), in a DOM: it shows the
// stored value, keeps the owner's pick while the stored value is unchanged (typing, a
// refused save) and follows it when it changes (this save landed, or another tab saved).
test.group("useStoredChoice in a DOM (TAT-56)", (group) => {
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

	function mount() {
		let latest: [string, (next: string) => void] | undefined;
		function Group({ stored }: { stored: string }) {
			latest = useStoredChoice(stored);
			return null;
		}
		const host = dom.window.document.getElementById("root") as HTMLElement;
		host.replaceChildren();
		const root = client.createRoot(host);
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
});
