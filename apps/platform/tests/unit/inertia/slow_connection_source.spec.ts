import { readdir, readFile } from "node:fs/promises";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { NO_VIA } from "#modules/notifications/messages";
import { lastContactText } from "#modules/projects/contact";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; the type below restates its one export and the inertia project type-checks the real one.
import * as messagesModule from "../../../inertia/components/messages.js";

const { MARKED_CONTACTED_TEXT } = messagesModule as {
	MARKED_CONTACTED_TEXT: string;
};

const read = (file: string) =>
	readFile(new URL(`../../../inertia/${file}`, import.meta.url), "utf8");

// TAT-84: Playwright is not in CI, so the in-flight states of the slow-connection pass are pinned
// at the source here and measured in a browser pass (the behaviour of the lost-connection toast
// and of the focus rule is the pure module in visits.spec.ts).
test.group("One-tap moves send once (TAT-84)", () => {
	test("MoveButton is disabled while saving, ignores a held Enter and sends from one place", async ({
		assert,
	}) => {
		const source = await read("components/change_card.tsx");
		for (const needle of [
			"export function MoveButton(",
			"sending.current",
			"disabled={saving}",
			'"Saving…"',
			"onKeyDown={ignoreHeldEnter}",
			"focusBack(",
		]) {
			assert.include(source, needle);
		}
		const card = source.slice(
			source.indexOf("const ask = CONFIRM[move]"),
			source.indexOf("export function MoveButton("),
		);
		assert.include(card, "<MoveButton");
		assert.notInclude(card, "onClick={() => post(move)}");
	});

	test("the Next step card's Resume is the same button", async ({ assert }) => {
		const source = await read("components/next_step_card.tsx");
		assert.include(source, "<MoveButton");
		assert.notInclude(source, "tenant.projects.moves.store");
	});

	test("the artist picker's Save says Saving… while it is out", async ({
		assert,
	}) => {
		const source = await read("components/change_card.tsx");
		const field = source.slice(source.indexOf("function ArtistField("));
		assert.include(field, 'processing ? "Saving…" : "Save"');
	});
});

test.group("Optimistic only for Mark contacted and notes (TAT-84)", () => {
	test("the words shown at once are the server's words for a contact now with no channel", ({
		assert,
	}) => {
		assert.equal(
			MARKED_CONTACTED_TEXT,
			lastContactText(DateTime.now(), "Asia/Kathmandu", NO_VIA),
		);
	});

	test("the project page makes exactly its two changes optimistic", async ({
		assert,
	}) => {
		const source = await read("pages/projects/show.tsx");
		assert.include(source, "MARKED_CONTACTED_TEXT");
		assert.include(source, "lastChannel: null");
		assert.lengthOf(source.match(/\boptimistic:/g) ?? [], 1);
		assert.lengthOf(source.match(/\boptimistic=\{/g) ?? [], 1);
		assert.include(
			source,
			"onMarkContacted={closed ? undefined : markContactedAtOnce}",
		);
	});

	test("nothing else in the dashboard is optimistic (ui.md)", async ({
		assert,
	}) => {
		const files = (
			await readdir(new URL("../../../inertia/", import.meta.url), {
				recursive: true,
			})
		).filter(
			(file) =>
				/\.tsx?$/.test(file) &&
				!file.startsWith("components/ui/") &&
				file !== "pages/projects/show.tsx",
		);
		assert.isAbove(files.length, 50);
		for (const file of files) {
			assert.notMatch(await read(file), /\boptimistic\s*[:=]/, file);
		}
	});
});

test.group("Small fixes (TAT-84)", () => {
	test("the agenda's time column fits Mon 22:30 on one line", async ({
		assert,
	}) => {
		const source = await read("components/day_agenda.tsx");
		// The column is the span around the one that holds the start time.
		const column = source
			.slice(0, source.indexOf("{session.startText}"))
			.match(/className="([^"]*)"/g)
			?.at(-2);
		assert.isDefined(column);
		assert.include(column, "w-20");
		assert.include(column, "whitespace-nowrap");
		assert.notInclude(column, "w-18");
	});

	test("the Clients search's Clear link is a 44 px target on phones", async ({
		assert,
	}) => {
		const source = await read("pages/clients/index.tsx");
		const classes = source.match(
			/<Link[^>]*className="([^"]*)"[^>]*>\s*Clear\s*<\/Link>/,
		)?.[1];
		assert.isDefined(classes);
		assert.include(classes, "max-lg:min-h-11");
		assert.notInclude(classes, "self-center");
	});
});
