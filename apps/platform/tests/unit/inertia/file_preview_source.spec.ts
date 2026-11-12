import { readdir, readFile } from "node:fs/promises";
import { test } from "@japa/runner";

const root = new URL("../../../inertia/", import.meta.url);
const read = (file: string) => readFile(new URL(file, root), "utf8");

/** Every .tsx file under inertia/, relative to it. */
async function sources(): Promise<string[]> {
	const entries = await readdir(root, { recursive: true });
	return entries.filter((path) => path.endsWith(".tsx"));
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
			if (!/type="file"/.test(source)) {
				if (/<ImageFileInput\b/.test(source)) fields.push(file);
				continue;
			}
			const needs = withPreview.get(file);
			assert.isDefined(needs, `${file} has a file input without a preview`);
			for (const name of needs ?? []) assert.include(source, name, file);
		}
		// The single-image forms: the cover, the logo, an artist's photo, a
		// payment QR code and a flash design's picture.
		assert.sameMembers(fields, [
			"components/cover_photo_form.tsx",
			"components/flash_tray.tsx",
			"components/logo_form.tsx",
			"pages/artists/form.tsx",
			"pages/settings/payment_method_form.tsx",
		]);
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

	test("the work photo tray never sends a file it already knows is wrong", async ({
		assert,
	}) => {
		const source = await read("components/work_photo_upload.tsx");
		assert.match(
			source,
			/const wrong = fileProblem\(file\);\s*if \(wrong\) \{\s*failures\.push\(\{ id, line: failureLine\(file\.name, wrong\) \}\);\s*mark\(id, \{ state: "refused", message: wrong \}\);\s*continue;/,
		);
	});
});
