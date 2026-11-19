import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `TextModule` below restates its shape and the inertia project type-checks the real one.
import * as textModule from "../../../inertia/components/downgrade_storage_text.js";

type Preview = { soloText: string; overText: string | null };
type TextModule = {
	downgradeStorageText(preview: Preview, enforced: boolean): string;
};
const { downgradeStorageText } = textModule as TextModule;

/** The downgrade preview's words (the storage meter, step 4). */
test.group("Downgrade storage preview", () => {
	test("under Solo's allowance everything fits", ({ assert }) => {
		assert.equal(
			downgradeStorageText({ soloText: "5 GB", overText: null }, true),
			"On Solo, everything you keep fits in its 5 GB.",
		);
	});

	test("over it, nothing is deleted and uploads pause", ({ assert }) => {
		assert.equal(
			downgradeStorageText({ soloText: "5 GB", overText: "2.4 GB" }, true),
			"On Solo, your files would be 2.4 GB over its 5 GB. Nothing is deleted: your files stay, and new uploads pause until there's room.",
		);
	});

	test("before limits apply, it says uploads pause only once they do", ({
		assert,
	}) => {
		assert.equal(
			downgradeStorageText({ soloText: "5 GB", overText: "40 MB" }, false),
			"On Solo, your files would be 40 MB over its 5 GB. Nothing is deleted: your files stay, and once storage limits apply, new uploads pause until there's room.",
		);
	});
});
