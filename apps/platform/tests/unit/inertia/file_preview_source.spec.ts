import { readdir, readFile } from "node:fs/promises";
import { test } from "@japa/runner";

const root = new URL("../../../inertia/", import.meta.url);
const read = (file: string) => readFile(new URL(file, root), "utf8");

/** Every .ts and .tsx file under inertia/, relative to it. */
async function sources(): Promise<string[]> {
	const entries = await readdir(root, { recursive: true });
	return entries.filter(
		(path) => /\.tsx?$/.test(path) && !path.endsWith(".d.ts"),
	);
}

// Upload previews: Playwright is not in CI, so what every upload relies on is
// pinned in its source. An owner sees each chosen image before it is sent,
// from the browser's own copy of the file (an object URL, never a request),
// and every such URL is let go.
test.group("Upload previews", () => {
	test("every file field in the dashboard shows what was chosen before it is sent", async ({
		assert,
	}) => {
		const withPreview = new Map<string, string[]>([
			// The queues: each chosen file in a row with its thumbnail.
			["components/artwork_upload.tsx", ["FileThumb", "useObjectUrls"]],
			["components/work_photo_upload.tsx", ["FileThumb", "useObjectUrls"]],
			// The preview field itself.
			["components/file_preview.tsx", ["FileThumb", "useObjectUrls"]],
		]);
		const fields: string[] = [];
		for (const file of await sources()) {
			const source = await read(file);
			const inputs = source.match(/type="file"/g)?.length ?? 0;
			if (inputs === 0) {
				if (/<ImageFileInput\b/.test(source)) fields.push(file);
				continue;
			}
			const needs = withPreview.get(file);
			assert.isDefined(needs, `${file} has a file input without a preview`);
			assert.equal(inputs, 1, `${file}: one file input, the one with previews`);
			// Used, not only imported: the thumbnail is rendered.
			assert.match(source, /<FileThumb\b/, file);
			assert.include(source, "useObjectUrls()", file);
		}
		// The single-image forms: the cover, the logo, an artist's photo, a
		// payment QR code and a flash design's picture (a new one may join).
		assert.includeMembers(fields, [
			"components/cover_photo_form.tsx",
			"components/flash_tray.tsx",
			"components/logo_form.tsx",
			"pages/artists/form.tsx",
			"pages/settings/payment_method_form.tsx",
		]);
		for (const file of fields) {
			// Only a whole-form reset clears the preview (file_preview.tsx).
			assert.notMatch(await read(file), /resetOnSuccess=\{\[/, file);
		}
	});

	test("object URLs are made in one place and every one is let go", async ({
		assert,
	}) => {
		for (const file of await sources()) {
			if (file === "components/file_preview.tsx") continue;
			const source = await read(file);
			assert.notMatch(
				source,
				/URL\.(createObjectURL|revokeObjectURL)/,
				`${file} makes object URLs itself`,
			);
		}
		const source = await read("components/file_preview.tsx");
		// Revoked when the component goes, and one by one as previews are replaced.
		assert.match(
			source,
			/return \(\) => \{\s*for \(const url of all\) URL\.revokeObjectURL\(url\);/,
		);
		assert.match(source, /const revoke = useCallback\(/);
		// The single-image field: a form reset after a save empties its preview.
		assert.match(source, /form\.addEventListener\("reset", cleared\)/);
		assert.match(source, /form\.removeEventListener\("reset", cleared\)/);
		// A wrong file has no preview, and says why.
		assert.match(source, /const url = problem \? null : create\(file\);/);
	});

	test("the work photo tray sends only what planUpload takes, and counts the room by it", async ({
		assert,
	}) => {
		const source = await read("components/work_photo_upload.tsx");
		assert.match(source, /const plan = planUpload\(files\);/);
		assert.match(source, /roomNote\(room, plan\.send\.length\)/);
		assert.match(source, /for \(const \[at, id\] of plan\.send\.entries\(\)\)/);
		assert.notMatch(source, /for \(const \[id, file\] of files\.entries\(\)\)/);
	});

	test("a wrong file in a single-image field is marked invalid, said, and never sent", async ({
		assert,
	}) => {
		const source = await read("components/file_preview.tsx");
		assert.match(source, /setCustomValidity\(problem \?\? ""\)/);
		assert.match(
			source,
			/aria-invalid=\{props\["aria-invalid"\] \|\| !!chosen\?\.problem\}/,
		);
		assert.match(source, /<span role="alert" className="text-destructive">/);
	});
});
