import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = new URL("../../src/", import.meta.url);

/** Local files named by url(...) in the stylesheet, relative to src/. */
function stylesheetFiles(css: string): string[] {
	return Array.from(css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g))
		.map((match) => match[1])
		.filter((href) => !/^(data:|https?:|\/\/)/.test(href));
}

describe("the stylesheet's files", () => {
	const css = readFileSync(new URL("styles.css", SRC), "utf8");

	test("every url() names a file that exists (a missing font would 404 on every page)", () => {
		for (const href of stylesheetFiles(css)) {
			assert.ok(
				existsSync(new URL(href, SRC)),
				`styles.css points at ${href}, which isn't in src/`,
			);
		}
	});

	test("loads nothing from another origin", () => {
		assert.doesNotMatch(css, /@import\s+(url\()?['"]?(https?:)?\/\//);
		assert.doesNotMatch(css, /url\(\s*['"]?(https?:)?\/\//);
	});

	test("every font stack ends in a generic family", () => {
		const faces = Array.from(
			css.matchAll(/--(?:body|display)-face:\s*([^;]+);/g),
			(match) => match[1],
		);
		assert.equal(faces.length, 2);
		for (const face of faces) {
			assert.match(face.trim(), /(?:^|,\s*)(?:serif|sans-serif)$/, face);
		}
	});

	test("the display stack names Eczar, then Devanagari-capable serifs", () => {
		const display = /--display-face:\s*([^;]+);/.exec(css)?.[1] ?? "";
		assert.match(display, /^Eczar, 'Noto Serif Devanagari', 'Noto Serif', /);
	});
});

describe("route imports of built assets", () => {
	test("every ?url import in src/ names a file that exists", () => {
		const files = readdirSync(SRC, { recursive: true })
			.map(String)
			.filter((file) => /\.(ts|tsx)$/.test(file));
		for (const file of files) {
			const text = readFileSync(new URL(file, SRC), "utf8");
			for (const match of text.matchAll(/from\s+["']([^"']+)\?url["']/g)) {
				const target = new URL(match[1], new URL(file, SRC));
				assert.ok(
					existsSync(fileURLToPath(target)),
					`${file} imports ${match[1]}?url, which doesn't exist`,
				);
			}
		}
	});
});

describe("the vendored Eczar files", () => {
	const css = readFileSync(new URL("styles.css", SRC), "utf8");
	const root = readFileSync(new URL("routes/__root.tsx", SRC), "utf8");
	const SUBSETS = ["latin", "latin-ext", "devanagari"] as const;
	const faces = Array.from(
		css.matchAll(/@font-face\s*\{([^}]*)\}/g),
		(m) => m[1],
	);

	test("three @font-face blocks, one per subset, bold, font-display: optional", () => {
		assert.equal(faces.length, SUBSETS.length);
		for (const subset of SUBSETS) {
			const block = faces.find((face) =>
				face.includes(`eczar-${subset}-700-normal.woff2`),
			);
			assert.ok(block, `no @font-face for the ${subset} subset`);
			assert.match(block, /font-family:\s*'Eczar'/);
			assert.match(block, /font-weight:\s*700/);
			assert.match(block, /font-display:\s*optional/);
			assert.match(block, /format\('woff2'\)/);
			assert.match(block, /unicode-range:\s*U\+/);
		}
	});

	test("each subset covers its own characters", () => {
		const range = (subset: string) =>
			faces.find((face) => face.includes(`eczar-${subset}-700-normal`)) ?? "";
		assert.match(range("devanagari"), /U\+0900-097F/);
		assert.match(range("latin"), /U\+0000-00FF/);
		assert.match(range("latin-ext"), /U\+0100-02BA/);
	});

	test("every file exists, is a woff2 and is small", () => {
		for (const subset of SUBSETS) {
			const file = new URL(
				`assets/fonts/eczar/eczar-${subset}-700-normal.woff2`,
				SRC,
			);
			assert.ok(existsSync(file), `${subset} file is missing`);
			const bytes = readFileSync(file);
			assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", subset);
			assert.ok(
				bytes.length < 150 * 1024,
				`${subset} is ${bytes.length} bytes`,
			);
		}
	});

	test("the SIL Open Font License sits next to the files", () => {
		const licence = readFileSync(
			new URL("assets/fonts/eczar/OFL.txt", SRC),
			"utf8",
		);
		assert.match(licence, /SIL OPEN FONT LICENSE Version 1\.1/i);
		assert.match(licence, /Eczar Project Authors/);
	});

	test("only the Latin file is preloaded, as a CORS-anonymous font", () => {
		const preloads = Array.from(root.matchAll(/rel:\s*"preload"/g));
		assert.equal(preloads.length, 1);
		assert.match(
			root,
			/import eczarLatin from "\.\.\/assets\/fonts\/eczar\/eczar-latin-700-normal\.woff2\?url"/,
		);
		assert.match(root, /href:\s*eczarLatin/);
		assert.match(root, /as:\s*"font"/);
		assert.match(root, /type:\s*"font\/woff2"/);
		assert.match(root, /crossOrigin:\s*"anonymous"/);
		assert.doesNotMatch(root, /eczar-(latin-ext|devanagari)/);
	});
});
