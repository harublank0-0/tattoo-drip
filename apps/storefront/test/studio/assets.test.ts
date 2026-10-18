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

// PENDING (TAT-48 font follow-up, needs the user's permission to download
// @fontsource/eczar@5.3.0 from npm): once the three woff2 files and OFL.txt
// are vendored in src/assets/fonts/eczar/, replace this todo with tests that
// pin: three @font-face blocks (latin, latin-ext, devanagari) with
// font-display: optional; only the Latin file is preloaded (a ?url import in
// routes/__root.tsx); OFL.txt sits next to the files; each woff2 is under
// 150 KB.
describe("the vendored Eczar files", () => {
	test(
		"are declared with font-display: optional and the Latin file is preloaded",
		{
			todo: "pending the user's permission to download @fontsource/eczar",
		},
	);
});
