import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";

const read = (file: string) =>
	readFile(new URL(`../../../inertia/${file}`, import.meta.url), "utf8");

// The storage meter: every page where a member uploads a studio file shows
// the studio's storage line (docs/superpowers/specs/2026-11-16-storage-meter-design.md,
// What people see). A source scan, because Playwright is not in CI.
test.group("Storage line on upload pages", () => {
	test("each page with a studio upload renders <StorageLine />", async ({
		assert,
	}) => {
		for (const file of [
			"pages/portfolio/index.tsx",
			"pages/artists/form.tsx",
			// The cover upload (CoverPhotoForm) lives on Profile, not Look.
			"pages/settings/profile.tsx",
			"pages/design_lab/show.tsx",
		]) {
			assert.include(await read(file), "<StorageLine />", file);
		}
	});
});
