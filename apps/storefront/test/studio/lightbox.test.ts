import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * The photo viewer (TAT-116) is the browser's own modal `<dialog>`: Escape,
 * the first focus, the return of focus and the inert page behind it are all
 * the browser's. These source guards keep it that way: the one DOM call is
 * `showPhoto` in src/studio/lightbox.ts, and no component adds focus code,
 * listeners, a scroll lock or a custom overlay.
 */
const SRC = new URL("../../src/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, SRC), "utf8");

const sources = (folder: string) =>
	readdirSync(new URL(folder, SRC), { recursive: true })
		.map(String)
		.filter((file) => /\.(ts|tsx)$/.test(file))
		.map((file) => ({
			file: `${folder}${file}`,
			text: read(`${folder}${file}`),
		}));

const rule = (css: string, selector: string) => {
	const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
	for (const match of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const own = match[1].split(/[;}]/).pop()?.trim();
		if (own === selector) return match[2];
	}
	return "";
};

describe("the photo viewer is the browser's dialog (TAT-116)", () => {
	test("showModal is called in lightbox.ts only", () => {
		const callers = [
			...sources("studio/"),
			...sources("routes/"),
			...sources("intake/"),
			...sources("deposit/"),
		]
			.filter(({ text }) => text.includes("showModal"))
			.map(({ file }) => file);
		assert.deepEqual(callers, ["studio/lightbox.ts"]);
	});

	test("showPhoto opens a closed dialog by id, guards a browser without <dialog>, and adds one history entry at the same address (TAT-123)", () => {
		const text = read("studio/lightbox.ts");
		assert.match(text, /export function showPhoto\(id: string\): void/);
		assert.match(text, /document\.getElementById\(id\)/);
		assert.match(text, /typeof HTMLDialogElement/);
		assert.match(text, /instanceof HTMLDialogElement/);
		assert.match(text, /dialog\.open \|\| leaving/);
		assert.equal((text.match(/document\./g) ?? []).length, 1);
		// The browser's own pushState with no URL: the address never changes, and
		// TanStack's wrapper on window.history (which runs the loaders) is not used.
		assert.match(
			text,
			/History\.prototype\.pushState\.call\(history, entry, ""\)/,
		);
		assert.match(
			text,
			/History\.prototype\.replaceState\.call\(history, entry, ""\)/,
		);
		assert.doesNotMatch(text, /history\.pushState\(|history\.replaceState\(/);
		// A marker left on the entry the page loaded on is taken off the same way.
		assert.match(
			text,
			/History\.prototype\.replaceState\.call\(history, router, ""\)/,
		);
		// The wait for a closed photo's back() is its popstate, never a timer.
		assert.doesNotMatch(text, /setTimeout|clearTimeout|LEAVE_WAIT_MS/);
		assert.doesNotMatch(text, /location\.hash|location\.href|\.hash =/);
		assert.doesNotMatch(text, /@tanstack/, "the router is never imported");
	});

	test("the components hold no focus code, listeners or DOM access", () => {
		// pages.tsx also holds the router's error page, which reloads the
		// page (`window`, `preventDefault`): not part of the viewer.
		const viewer = [
			"studio/components/artists.tsx",
			"studio/components/brand.tsx",
			"studio/components/gallery.tsx",
		];
		for (const { file, text } of sources("studio/components/")) {
			const forbidden = [
				"tabIndex",
				".focus(",
				"addEventListener",
				"document.",
				"useEffect",
				"useState",
				"useRef",
				...(viewer.includes(file) ? ["preventDefault", "window."] : []),
			];
			for (const word of forbidden) {
				assert.ok(!text.includes(word), `${file} uses ${word}`);
			}
		}
	});

	test("Show more's focus move is the only DOM access outside lightbox.ts", () => {
		// The paging island (src/studio/paging.tsx) is the one stateful piece:
		// after a click it moves focus to the first new photo, once.
		const paging = read("studio/paging.tsx");
		assert.equal((paging.match(/document\.getElementById/g) ?? []).length, 1);
		assert.equal((paging.match(/\.focus\(/g) ?? []).length, 1);
		const others = sources("studio/")
			.filter(
				({ file }) =>
					file !== "studio/lightbox.ts" && file !== "studio/paging.tsx",
			)
			.filter(({ text }) => text.includes("document."))
			.map(({ file }) => file);
		assert.deepEqual(others, []);
	});

	test("open-now.tsx holds the cover's only timer and touches no DOM (TAT-128)", () => {
		const text = read("studio/open-now.tsx");

		assert.match(text, /setInterval/);
		assert.match(text, /clearInterval/);
		assert.ok(!text.includes("document."), "open-now.tsx uses document.");
		assert.ok(!text.includes("window."), "open-now.tsx uses window.");
		for (const { file, text: other } of sources("studio/")) {
			if (file === "studio/open-now.tsx") continue;
			assert.ok(!other.includes("setInterval"), `${file} uses setInterval`);
		}
	});

	test("the page's scroll is never locked", () => {
		const css = read("styles.css");
		for (const selector of ["html", "body", ":root"]) {
			assert.doesNotMatch(
				rule(css, selector),
				/overflow\s*:\s*hidden/,
				selector,
			);
		}
		assert.doesNotMatch(
			css,
			/:has\(\s*(?:\.work-dialog|dialog)\[open\]\s*\)[^{]*\{[^}]*overflow/,
		);
	});

	test("the dialog scrolls inside itself, and a closed one stays hidden", () => {
		const css = read("styles.css");
		const dialog = rule(css, ".work-dialog");
		assert.match(dialog, /overscroll-behavior:\s*contain/);
		assert.match(dialog, /overflow:\s*auto/);
		// Only the open dialog sets `display`, or a closed one would show.
		assert.doesNotMatch(dialog, /(?:^|[;\s])display\s*:/);
		assert.match(rule(css, ".work-dialog[open]"), /display:\s*grid/);
		// Where <dialog> is unknown the element is an inline unknown element
		// and would show every large photo: hide it unless it is open.
		assert.match(rule(css, ".work-dialog:not([open])"), /display:\s*none/);
	});

	test("Close is a 48 px control and the large photo fits the screen", () => {
		const css = read("styles.css");
		assert.match(rule(css, ".action"), /min-height:\s*3rem/);
		assert.match(
			rule(css, ".work-large"),
			/max-block-size:\s*calc\(100dvh\s*-\s*8rem\)/,
		);
		assert.match(rule(css, ".work-large"), /object-fit:\s*contain/);
	});
});
