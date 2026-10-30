import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";

const read = (file: string) =>
	readFile(new URL(`../../../inertia/${file}`, import.meta.url), "utf8");

// TAT-129 fix round 1: a design's upload is a sync Inertia visit, and so is every other
// write of the tray (a row's Remove, the sheet's Save). Starting one while another is out
// cancels the first silently, possibly after the server saved it. The work photo tray
// holds Save and Remove while its upload goes (`onBusyChange`); the flash tray does the
// same. Playwright is not in CI, so the wiring is pinned in the source.
test.group(
	"The flash tray holds its other writes during an upload (TAT-129)",
	() => {
		test("the add form tells the tray while its visit is out, and the tray keeps the state", async ({
			assert,
		}) => {
			const source = await read("components/flash_tray.tsx");
			const add = source.match(
				/<Form\s+route="tenant\.artists\.flash\.store"[\s\S]*?\{\(\{ errors/,
			);

			assert.match(
				source,
				/const \[uploading, setUploading\] = useState\(false\)/,
			);
			assert.match(source, /<AddDesign[^>]*onBusyChange=\{setUploading\}/);
			assert.isNotNull(add, "the add form is there");
			assert.match(add?.[0] ?? "", /onStart=\{\(\) => onBusyChange\(true\)\}/);
			assert.match(
				add?.[0] ?? "",
				/onFinish=\{\(\) => onBusyChange\(false\)\}/,
			);
		});

		test("every row's Remove and the sheet's Save are held while it goes", async ({
			assert,
		}) => {
			const source = await read("components/flash_tray.tsx");

			assert.match(source, /<InlineConfirm[^>]*disabled=\{uploading\}/);
			assert.match(source, /<DesignDetails[^>]*uploading=\{uploading\}/);
			assert.match(source, /<FormSheetActions[^>]*held=\{uploading\}/);
		});

		test("InlineConfirm and FormSheetActions can be held: the trigger and confirm button, and the submit button", async ({
			assert,
		}) => {
			const confirm = await read("components/inline_confirm.tsx");
			const sheet = await read("components/form_sheet.tsx");

			assert.match(confirm, /disabled\?: boolean/);
			// The trigger and the confirm button; "keep" stays usable to close the panel.
			assert.match(
				confirm,
				/aria-controls=\{panelId\}[^>]*disabled=\{disabled\}/,
			);
			assert.match(confirm, /disabled=\{state\.saving \|\| disabled\}/);
			assert.match(sheet, /held\?: boolean/);
			assert.match(sheet, /disabled=\{processing \|\| held\}/);
		});
	},
);
