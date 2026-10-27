import { readdir, readFile } from "node:fs/promises";
import { test } from "@japa/runner";

const read = (file: string) =>
	readFile(new URL(`../../../inertia/${file}`, import.meta.url), "utf8");

// TAT-108: the project and inquiry pages ask in the page, never in the browser's dialog. A source
// scan, because Playwright is not in CI; the behaviour itself (focus on the safe button, Escape,
// the sheet staying open on a refusal) is the pure steps in confirm_and_sheets.spec.ts and a
// browser pass.
test.group(
	"No window.confirm on the project and inquiry pages (TAT-108)",
	() => {
		test("the money and quote forms in sheets neither confirm nor use onBefore", async ({
			assert,
		}) => {
			for (const file of [
				"components/payments_card.tsx",
				"components/quote_card.tsx",
			]) {
				const source = await read(file);
				assert.notInclude(source, "window.confirm", file);
				assert.notMatch(source, /[^\w.]confirm\(/, file);
				assert.notInclude(source, "onBefore=", file);
			}
		});

		test("no project page, inquiry page or shared component calls the browser's confirm", async ({
			assert,
		}) => {
			const components = (
				await readdir(new URL("../../../inertia/components/", import.meta.url))
			)
				.filter((name) => name.endsWith(".tsx"))
				.map((name) => `components/${name}`);
			// pages/calendar has a confirm function of its own, and Settings and Artists still
			// ask with the browser's dialog (a follow-up), so they are not scanned.
			const files = [
				"pages/projects/show.tsx",
				"pages/inquiries/show.tsx",
				...components,
			];
			assert.isAbove(components.length, 10);
			for (const file of files) {
				const source = await read(file);
				assert.notInclude(source, "window.confirm", file);
				assert.notMatch(source, /[^\w.]confirm\(/, file);
			}
		});
	},
);

// TAT-108: a phone reads the page in DOM order and so does Tab, so the order is the page's design.
test.group("The project page's layout (TAT-108)", () => {
	test("the left column runs from the Next step to the changes, the right holds the money and the quote", async ({
		assert,
	}) => {
		const source = await read("pages/projects/show.tsx");
		const order = [
			"<NextStepCard",
			"<SessionsCard",
			"<MessageCard",
			"<RequestCard",
			"<NotesCard",
			"<ChangeCard",
			"<PaymentsCard",
			"<QuoteCard",
		].map((tag) => source.indexOf(tag));
		assert.notInclude(order, -1, "every card is on the page");
		assert.deepEqual(
			order,
			[...order].sort((a, b) => a - b),
			"DOM order is reading order",
		);
		// Two columns from lg, the right one staying in view while the left scrolls.
		for (const classes of ["lg:col-span-7", "lg:col-span-5", "lg:sticky"]) {
			assert.include(source, classes);
		}
	});
});

// A sheet that just saved stays on the page for its exit animation, form filled in: nothing may be
// sent from it (TAT-108 fix round, a refund sent twice by a held Enter). The rule is `maySubmit`
// (confirm_and_sheets.spec.ts); this pins that the sheet applies it.
test.group("A closing sheet cannot be submitted (TAT-108)", () => {
	test("the sheet is inert once it is closed and guards its form's submit", async ({
		assert,
	}) => {
		const source = await read("components/form_sheet.tsx");
		assert.include(source, "inert={!sheet.state.open}");
		assert.include(source, "onSubmitCapture={sheet.guard}");
		assert.include(source, "maySubmit(latest.current)");
		assert.include(source, "event.preventDefault()");
	});

	test("the inline confirm sends its request only from the step that starts it", async ({
		assert,
	}) => {
		const source = await read("components/inline_confirm.tsx");
		assert.include(source, "latest.current.saving");
		assert.include(source, "!wasSaving");
	});
});

// A sheet that lives inside the card its trigger sits in is unmounted when the Next step moves that
// trigger to another card, and a refusal (a stale Revise: someone revised first) disappears with it.
// Each sheet is one instance mounted by the page, whichever card draws its trigger.
test.group("One instance per sheet, mounted by the page (TAT-108)", () => {
	const PANELS = [
		"RevisePanel",
		"PricePanel",
		"RecordPaymentPanel",
		"RefundPanel",
		"SchedulePanel",
	];

	test("the page mounts each sheet's panel once and holds its state", async ({
		assert,
	}) => {
		const page = await read("pages/projects/show.tsx");
		assert.include(page, "usePageSheets()");
		for (const panel of PANELS) {
			assert.equal(page.split(`<${panel}`).length - 1, 1, panel);
		}
	});

	test("no card owns a sheet's state or its Radix trigger", async ({
		assert,
	}) => {
		for (const file of [
			"components/quote_card.tsx",
			"components/payments_card.tsx",
			"components/sessions_card.tsx",
			"components/next_step_card.tsx",
		]) {
			const source = await read(file);
			assert.notInclude(source, "useFormSheet(", file);
			assert.notInclude(source, "<SheetTrigger", file);
			assert.notMatch(source, /<FormSheet[\s>]/, file);
		}
		// Only the shared trigger opens a sheet.
		assert.include(
			await read("components/form_sheet.tsx"),
			"export function FormSheetTrigger",
		);
	});

	test("a refusal's toast is dismissed only for a message a sheet is showing", async ({
		assert,
	}) => {
		const source = await read("components/form_sheet.tsx");
		assert.include(source, "state.message");
		assert.notInclude(source, "if (page.flash?.error) setTimeout");
	});
});
