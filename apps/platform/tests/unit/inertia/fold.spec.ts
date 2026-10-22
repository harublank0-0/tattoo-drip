import { test } from "@japa/runner";
import { JSDOM } from "jsdom";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `FoldModule` below restates its shape and the inertia project type-checks the real one.
import * as foldModule from "../../../inertia/components/fold.js";

type Fold = {
	clamp: boolean;
	showToggle: boolean;
	label: string;
	expanded: boolean;
	setExpanded(expanded: boolean): void;
	textRef: { current: HTMLElement | null };
	toggleRef: { current: HTMLElement | null };
};
type FoldModule = {
	FOLD_LINES: number;
	foldToggle(
		expanded: boolean,
		overflows: boolean,
	): { clamp: boolean; showToggle: boolean; label: string };
	useFold(text: string): Fold;
};
const { FOLD_LINES, foldToggle, useFold } = foldModule as FoldModule;

test.group("foldToggle (TAT-104)", () => {
	test("the preview folds to two lines", ({ assert }) => {
		assert.equal(FOLD_LINES, 2);
	});

	test("a long message is folded, with a toggle that offers to show it", ({
		assert,
	}) => {
		assert.deepEqual(foldToggle(false, true), {
			clamp: true,
			showToggle: true,
			label: "Show message",
		});
	});

	test("shown in full, the toggle offers to hide it again", ({ assert }) => {
		assert.deepEqual(foldToggle(true, true), {
			clamp: false,
			showToggle: true,
			label: "Hide message",
		});
	});

	test("a message that fits in two lines has nothing to fold", ({ assert }) => {
		assert.deepEqual(foldToggle(false, false), {
			clamp: true,
			showToggle: false,
			label: "Show message",
		});
	});
});

// The hook in a DOM. jsdom has no layout, so the box's size is a stand-in:
// a message has as many lines as it has line breaks plus one, 20px each, and
// the folded box shows at most two of them. A ResizeObserver that never
// fires stands for the case that matters: the clamped box keeps its size.
test.group("useFold in a DOM (TAT-104)", (group) => {
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
		"MouseEvent",
		"ResizeObserver",
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
			MouseEvent: window.MouseEvent,
			ResizeObserver: class {
				observe() {}
				disconnect() {}
			},
			IS_REACT_ACT_ENVIRONMENT: true,
		});
		const lines = (element: HTMLElement) =>
			(element.textContent ?? "").split("\n").length;
		Object.defineProperty(window.HTMLElement.prototype, "scrollHeight", {
			configurable: true,
			get(this: HTMLElement) {
				return lines(this) * 20;
			},
		});
		Object.defineProperty(window.HTMLElement.prototype, "clientHeight", {
			configurable: true,
			get(this: HTMLElement) {
				const shown =
					this.dataset.clamped === "true"
						? Math.min(lines(this), FOLD_LINES)
						: lines(this);
				return shown * 20;
			},
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

	/** A preview like ChatMessage's: the text, and the toggle while there is one. */
	function mount() {
		const h = react.createElement;
		let latest: Fold | undefined;
		function Preview({ text }: { text: string }) {
			const fold = useFold(text);
			latest = fold;
			return h(
				"div",
				null,
				fold.showToggle &&
					h(
						"button",
						{
							type: "button",
							ref: fold.toggleRef,
							"aria-expanded": fold.expanded,
							onClick: () => fold.setExpanded(!fold.expanded),
						},
						fold.label,
					),
				h(
					"p",
					{
						ref: fold.textRef,
						tabIndex: -1,
						"data-clamped": String(fold.clamp),
					},
					text,
				),
			);
		}
		const host = dom.window.document.getElementById("root") as HTMLElement;
		host.replaceChildren();
		const root = client.createRoot(host);
		return {
			render: (text: string) => act(() => root.render(h(Preview, { text }))),
			toggle: () => host.querySelector("button") as HTMLElement | null,
			text: () => host.querySelector("p") as HTMLElement,
			fold: () => latest as Fold,
			unmount: () => act(() => root.unmount()),
		};
	}
	const TWO = "first line\nsecond line";
	const THREE = "first line\nsecond line\nthird line";

	test("a message of exactly two lines has no toggle; a third line, arriving while mounted, brings it", async ({
		assert,
	}) => {
		const view = mount();
		await view.render(TWO);
		assert.isNull(view.toggle());
		// The clamped box keeps its height and no resize fires: only the new
		// text can tell the fold to look again.
		await view.render(THREE);
		assert.isNotNull(view.toggle());
		assert.equal(view.toggle()?.textContent, "Show message");
		await view.unmount();
	});

	test("the toggle goes again when the text shrinks back to two lines", async ({
		assert,
	}) => {
		const view = mount();
		await view.render(THREE);
		assert.isNotNull(view.toggle());
		await view.render(TWO);
		assert.isNull(view.toggle());
		await view.unmount();
	});

	test("the toggle opens and folds the text and reports it", async ({
		assert,
	}) => {
		const view = mount();
		await view.render(THREE);
		const toggle = view.toggle() as HTMLElement;
		assert.equal(toggle.getAttribute("aria-expanded"), "false");
		await act(() => {
			toggle.click();
		});
		assert.equal(view.toggle()?.getAttribute("aria-expanded"), "true");
		assert.equal(view.toggle()?.textContent, "Hide message");
		assert.equal(view.text().dataset.clamped, "false");
		await act(() => {
			view.toggle()?.click();
		});
		assert.equal(view.toggle()?.getAttribute("aria-expanded"), "false");
		assert.equal(view.text().dataset.clamped, "true");
		await view.unmount();
	});

	test("hiding the message when the text now fits keeps focus on the message, not on <body>", async ({
		assert,
	}) => {
		const view = mount();
		await view.render(THREE);
		await act(() => {
			(view.toggle() as HTMLElement).click();
		});
		// Open, the text is not measured: it changes to two lines meanwhile
		// (a rotated phone, a wider window), then "Hide message" is pressed.
		await view.render(TWO);
		const toggle = view.toggle() as HTMLElement;
		toggle.focus();
		assert.strictEqual(dom.window.document.activeElement, toggle);
		await act(() => {
			toggle.click();
		});
		assert.isNull(view.toggle());
		assert.strictEqual(dom.window.document.activeElement, view.text());
		await view.unmount();
	});
});
