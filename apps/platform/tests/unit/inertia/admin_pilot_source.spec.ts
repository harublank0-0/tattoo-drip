import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";

const read = () =>
	readFile(
		new URL("../../../inertia/pages/admin/studios/show.tsx", import.meta.url),
		"utf8",
	);

// The studio's admin page, Package section (admin pilot grants). A source
// scan, because Playwright is not in CI: the in-page confirm's own steps are
// unit-tested in confirm_and_sheets.spec.ts.
test.group("Admin pilot grants: the page", () => {
	test("ending a grant asks in the page first, never in one tap or the browser's dialog", async ({
		assert,
	}) => {
		const source = await read();
		assert.include(source, "<InlineConfirm");
		assert.include(source, 'urlFor("admin.studios.pilot.end"');
		assert.notInclude(source, 'route="admin.studios.pilot.end"');
		assert.notInclude(source, "window.confirm");
	});

	test("the package starts on the running grant's, else on a disabled Choose a package", async ({
		assert,
	}) => {
		const source = await read();
		assert.include(source, "pilot.defaultPackage");
		assert.include(source, "Choose a package");
	});
});
