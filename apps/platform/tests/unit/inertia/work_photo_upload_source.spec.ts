import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";

const read = (file: string) =>
	readFile(new URL(`../../../inertia/${file}`, import.meta.url), "utf8");

// TAT-126 fix round 2: Playwright is not in CI, so what the upload relies on
// in Inertia is pinned in its source. In production the server's 5xx is an
// Inertia page; unless onHttpException returns false, Inertia (3.8) renders it
// over the dashboard and then runs onSuccess, counting the failed photo as
// added. trackUpload (components/photos.ts) holds the callbacks.
test.group("The work photo upload's visits (TAT-126)", () => {
	test("each file's visit takes its callbacks from trackUpload, and nothing else decides the outcome", async ({
		assert,
	}) => {
		const source = await read("components/work_photo_upload.tsx");

		assert.match(source, /const upload = trackUpload\(\);/);
		assert.match(source, /\.\.\.upload\.callbacks/);
		assert.match(source, /onFinish: \(\) => resolve\(upload\.outcome\(\)\)/);
		for (const own of ["onSuccess", "onError", "onCancel", "onHttpException"]) {
			assert.notMatch(source, new RegExp(`\\b${own}\\s*[:(]`), own);
		}
	});

	test("trackUpload keeps onHttpException returning false", async ({
		assert,
	}) => {
		const source = await read("components/photos.ts");

		assert.match(source, /onHttpException: \(\) => false as const/);
	});
});
