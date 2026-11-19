import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `TextModule` below restates its shape and the inertia project type-checks the real one.
import * as textModule from "../../../inertia/components/downgrade_storage_text.js";

type Preview = { usedText: string; soloText: string; overText: string | null };
type TextModule = { downgradeStorageText(preview: Preview): string };
const { downgradeStorageText } = textModule as TextModule;

/** The downgrade preview's words (the storage meter, step 4). */
test.group("Downgrade storage preview", () => {
	test("under Solo's allowance it fits", ({ assert }) => {
		assert.equal(
			downgradeStorageText({
				usedText: "3.2 GB",
				soloText: "5 GB",
				overText: null,
			}),
			"On Solo (5 GB), your 3.2 GB fits.",
		);
	});

	test("over it, nothing is deleted and uploads pause", ({ assert }) => {
		assert.equal(
			downgradeStorageText({
				usedText: "7.4 GB",
				soloText: "5 GB",
				overText: "2.4 GB",
			}),
			"On Solo (5 GB), your 7.4 GB is 2.4 GB over. Nothing is deleted: your files stay, and new uploads pause until there's room.",
		);
	});
});
