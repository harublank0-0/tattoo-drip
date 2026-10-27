import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { showPhoto } from "../../src/studio/lightbox.ts";

/**
 * showPhoto (TAT-116 fix round 1) must not throw where `<dialog>` does not
 * exist (iOS before 15.4, Firefox before 98, old WebViews): there the photo
 * opens by itself, in its own page. The DOM is stood in by plain objects
 * because lightbox.ts reads the globals when it is called.
 */
const globals = globalThis as Record<string, unknown>;
const saved = {
	document: globals.document,
	HTMLDialogElement: globals.HTMLDialogElement,
	window: globals.window,
};

afterEach(() => {
	for (const [name, value] of Object.entries(saved)) {
		if (value === undefined) delete globals[name];
		else globals[name] = value;
	}
});

/** A page with one element of this id, and where the browser would go if told to. */
function page(element: unknown, dialogSupport: boolean) {
	const assigned: string[] = [];
	globals.document = {
		getElementById: (id: string) => (id === "work-photo-1" ? element : null),
	};
	globals.window = {
		location: { assign: (url: string) => assigned.push(url) },
	};
	if (dialogSupport) {
		globals.HTMLDialogElement = class {};
	} else {
		delete globals.HTMLDialogElement;
	}
	return assigned;
}

describe("showPhoto without <dialog> support (TAT-116 fix round 1)", () => {
	test("with a real dialog it opens it once", () => {
		let opened = 0;
		class FakeDialog {
			open = false;
			showModal() {
				opened++;
				this.open = true;
			}
		}
		const dialog = new FakeDialog();
		const assigned = page(dialog, true);
		globals.HTMLDialogElement = FakeDialog;

		showPhoto("work-photo-1");
		showPhoto("work-photo-1");

		assert.equal(opened, 1, "an open dialog is not opened again");
		assert.deepEqual(assigned, []);
	});

	test("where HTMLDialogElement does not exist it does not throw and goes to the large photo", () => {
		const dialog = {
			querySelector: (selector: string) =>
				selector === "img"
					? { src: "https://api.example.com/w.1280w.jpg" }
					: null,
		};
		const assigned = page(dialog, false);

		assert.doesNotThrow(() => showPhoto("work-photo-1"));

		assert.deepEqual(assigned, ["https://api.example.com/w.1280w.jpg"]);
	});

	test("an element that is not a dialog (an old engine's unknown element) takes the same fallback", () => {
		const element = {
			querySelector: () => ({ src: "https://api.example.com/w.jpg" }),
		};
		const assigned = page(element, true);

		assert.doesNotThrow(() => showPhoto("work-photo-1"));

		assert.deepEqual(assigned, ["https://api.example.com/w.jpg"]);
	});

	test("an unknown id, or a dialog without an image, does nothing", () => {
		const assigned = page({ querySelector: () => null }, false);

		showPhoto("nobody");
		showPhoto("work-photo-1");

		assert.deepEqual(assigned, []);
	});
});
