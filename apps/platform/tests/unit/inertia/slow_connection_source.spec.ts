import { readdir, readFile } from "node:fs/promises";
import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; the type below restates its one export and the inertia project type-checks the real one.
import * as messagesModule from "../../../inertia/components/messages.js";

type Shown = { contactedText: string; lastChannel: string | null };
type Mark = { id: string; via: { channel?: string; kind?: string } };
const { shownContact } = messagesModule as {
	shownContact(mark: Mark | null, recordId: string, server: Shown): Shown;
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

// TAT-84, fix round 1 (and the merge with main's contact recording): Inertia's own optimistic
// visits are not used anywhere. While one is pending Inertia swaps every page's props that share a
// name with the current page's for the CURRENT page's values, so a save on project A that is still
// out would leave project B's notes and contact line empty (or A's). A recorded contact shows its
// words from state held in the page, scoped to the project or inquiry it was tapped on; the notes
// save is an async partial visit.
test.group(
	"Recorded contacts and notes without optimistic visits (TAT-84)",
	() => {
		const server = {
			contactedText: "contacted 2 days ago on Viber",
			lastChannel: "viber",
		};

		test("the record it was tapped on shows what the server will say, and the channel it leads with", ({
			assert,
		}) => {
			assert.deepEqual(
				shownContact(
					{ id: "a", via: { channel: "whatsapp", kind: "quote" } },
					"a",
					server,
				),
				{
					contactedText: "contacted today on WhatsApp (Quote)",
					lastChannel: "whatsapp",
				},
			);
			assert.deepEqual(shownContact({ id: "a", via: {} }, "a", server), {
				contactedText: "contacted today",
				lastChannel: null,
			});
		});

		test("another record, or none being recorded, shows the server's own values", ({
			assert,
		}) => {
			const mark = { id: "a", via: { channel: "call" } };
			assert.deepEqual(shownContact(mark, "b", server), server);
			assert.deepEqual(shownContact(null, "a", server), server);
		});

		test("the hook keeps the mark in state scoped to the record and clears it when the visit ends", async ({
			assert,
		}) => {
			const source = await read("hooks/use-contact-recording.ts");
			assert.include(source, "useState<ContactMark | null>(null)");
			assert.include(source, "setMark({ id: recordId, via })");
			assert.include(source, "shownContact(mark, recordId, server)");
			assert.include(source, "setMark(null)");
			assert.include(source, "onFinish:");
		});

		test("the recording is an async partial visit: it interrupts no other save and is not cut off by a tap elsewhere", async ({
			assert,
		}) => {
			// Without `optimistic` (which implied async) a plain post is a sync visit: it would abort
			// the save in flight (an "Accept and create project", a payment) and be aborted by the
			// next navigation. `only` keeps a late answer from restoring any other prop; both pages
			// read the contact line and the leading channel from these two props.
			const source = await read("hooks/use-contact-recording.ts");
			assert.include(source, "async: true,");
			assert.include(source, 'only: ["contactedText", "lastChannel"],');
		});

		test("the project and inquiry pages record every contact through the hook, scoped to their own id", async ({
			assert,
		}) => {
			const project = await read("pages/projects/show.tsx");
			assert.include(project, "useContactRecording(");
			assert.include(project, "project.id,");
			assert.include(
				project,
				"onMarkContacted={closed ? undefined : () => markContacted()}",
			);
			const inquiry = await read("pages/inquiries/show.tsx");
			assert.include(inquiry, "useContactRecording(");
			assert.include(inquiry, "inquiry.id,");
			assert.include(inquiry, "footer={shownText}");
			for (const source of [project, inquiry]) {
				assert.notInclude(source, "justContacted(");
				assert.notInclude(source, 'contacted.store", params), via');
			}
		});

		test("the notes save is an async partial visit that still says Saving…", async ({
			assert,
		}) => {
			// `only: ["notes"]` keeps its answer (the redirect to the project page can be computed
			// before, and delivered after, a later answer) from restoring any other, older prop.
			const source = await read("pages/projects/show.tsx");
			const form = source.slice(source.indexOf("function NotesForm("));
			assert.include(
				form,
				'options={{ preserveScroll: true, async: true, only: ["notes"] }}',
			);
			assert.include(form, '"Saving…"');
		});

		test("no file under inertia/ passes `optimistic` to Inertia", async ({
			assert,
		}) => {
			const files = (
				await readdir(new URL("../../../inertia/", import.meta.url), {
					recursive: true,
				})
			).filter((file) => /\.tsx?$/.test(file));
			assert.isAbove(files.length, 50);
			for (const file of files) {
				assert.notMatch(
					await read(file),
					/\boptimistic\s*[:=(]|\.optimistic\b/,
					file,
				);
			}
		});
	},
);

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
