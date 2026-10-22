import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `ProjectListModule` below restates its shape and the inertia project type-checks the real one.
import * as listModule from "../../../inertia/components/project_list.js";

type Row = {
	artistName: string | null;
	line: { text: string; needsYou: boolean; hash: string | null } | null;
	nextSessionText: string | null;
	contactedText: string | null;
};
type View = {
	filter: string;
	waiting: string | null;
	sort: "needs" | "contact" | null;
};
type ProjectListModule = {
	ON_CLIENT_TITLE: string;
	SORT_LABELS: Record<"needs" | "contact", string>;
	listHref(
		base: string,
		query: {
			status?: string;
			waiting?: string | null;
			sort?: "needs" | "contact" | null;
			page?: number;
		},
	): string;
	cardLine(
		row: Pick<Row, "line" | "nextSessionText">,
	): { text: string; needsYou: boolean; hash: string | null } | null;
	cardMeta(
		row: Pick<Row, "artistName" | "contactedText">,
		options: { isOwner: boolean; sort: "needs" | "contact" | null },
	): string | null;
	emptyListText(
		view: Pick<View, "filter" | "waiting"> & {
			isOwner: boolean;
			page: { current: number; last: number };
		},
	): string;
	tableCaption(view: View, title: string | null): string;
	backLink(waiting: string): { label: string; status: string };
};
const {
	ON_CLIENT_TITLE,
	SORT_LABELS,
	listHref,
	cardLine,
	cardMeta,
	emptyListText,
	tableCaption,
	backLink,
} = listModule as ProjectListModule;

const BASE = "/t/x/projects";

test.group("listHref", () => {
	test("a chip carries its status, and nothing else by default", ({
		assert,
	}) => {
		assert.equal(listHref(BASE, { status: "active" }), `${BASE}?status=active`);
		assert.equal(
			listHref(BASE, { status: "needs_you", sort: "needs", page: 1 }),
			`${BASE}?status=needs_you`,
		);
		assert.equal(listHref(BASE, {}), BASE);
	});

	test("a waiting view needs only itself", ({ assert }) => {
		assert.equal(
			listHref(BASE, { status: "needs_you", waiting: "proofs" }),
			`${BASE}?waiting=proofs`,
		);
		assert.equal(
			listHref(BASE, { waiting: "on_client", page: 2 }),
			`${BASE}?waiting=on_client&page=2`,
		);
	});

	test("the contact sort and a later page are added, the defaults are not", ({
		assert,
	}) => {
		assert.equal(
			listHref(BASE, { status: "active", sort: "contact" }),
			`${BASE}?status=active&sort=contact`,
		);
		assert.equal(
			listHref(BASE, { status: "quoted", sort: null, page: 2 }),
			`${BASE}?status=quoted&page=2`,
		);
		assert.equal(
			listHref(BASE, { status: "active", sort: "contact", page: 3 }),
			`${BASE}?status=active&sort=contact&page=3`,
		);
	});
});

test.group("cardLine and cardMeta", () => {
	test("the card says what waits, else the next session, else nothing", ({
		assert,
	}) => {
		const line = {
			text: "Deposit screenshot to check",
			needsYou: true,
			hash: "payments",
		};
		assert.deepEqual(
			cardLine({ line, nextSessionText: "Sat 24 Oct, 11:00" }),
			line,
		);
		assert.deepEqual(
			cardLine({ line: null, nextSessionText: "Sat 24 Oct, 11:00" }),
			{ text: "Next session Sat 24 Oct, 11:00", needsYou: false, hash: null },
		);
		assert.isNull(cardLine({ line: null, nextSessionText: null }));
	});

	test("an owner's meta names the artist, and the contact in the contact sort", ({
		assert,
	}) => {
		const owner = (sort: "needs" | "contact" | null) => ({
			isOwner: true,
			sort,
		});
		assert.equal(
			cardMeta({ artistName: "Asha", contactedText: null }, owner("needs")),
			"With Asha",
		);
		assert.equal(
			cardMeta({ artistName: null, contactedText: null }, owner(null)),
			"No artist yet",
		);
		assert.equal(
			cardMeta(
				{
					artistName: "Asha",
					contactedText: "Contacted 2 days ago on WhatsApp (Quote)",
				},
				owner("contact"),
			),
			"With Asha · Contacted 2 days ago on WhatsApp (Quote)",
		);
		assert.equal(
			cardMeta({ artistName: null, contactedText: null }, owner("contact")),
			"No artist yet · No contact yet",
		);
	});

	test("an artist's meta is only the contact, only in the contact sort", ({
		assert,
	}) => {
		const row = { artistName: null, contactedText: "Contacted today" };
		assert.isNull(cardMeta(row, { isOwner: false, sort: "needs" }));
		assert.isNull(cardMeta(row, { isOwner: false, sort: null }));
		assert.equal(
			cardMeta(row, { isOwner: false, sort: "contact" }),
			"Contacted today",
		);
		assert.equal(
			cardMeta(
				{ artistName: null, contactedText: null },
				{ isOwner: false, sort: "contact" },
			),
			"No contact yet",
		);
	});

	test('"never contacted" appears in none of them', ({ assert }) => {
		const every = [
			cardMeta(
				{ artistName: null, contactedText: null },
				{ isOwner: true, sort: "contact" },
			),
			cardMeta(
				{ artistName: null, contactedText: null },
				{ isOwner: false, sort: "contact" },
			),
		];
		for (const text of every) assert.notMatch(text ?? "", /never contacted/i);
	});
});

test.group("emptyListText", () => {
	const first = { current: 1, last: 1 };
	const view = (
		filter: string,
		isOwner = true,
		waiting: string | null = null,
		page = first,
	) => emptyListText({ filter, waiting, isOwner, page });

	test("each view says what shows up there, for each role", ({ assert }) => {
		assert.equal(
			view("active"),
			"No projects yet. Accept a request in the Inbox or book a session, and it shows up here.",
		);
		assert.equal(
			view("active", false),
			"No projects for you yet. They show up here when the studio gives you one.",
		);
		assert.equal(
			view("needs_you"),
			"Nothing needs you right now. A project shows up here when it needs a price, a deposit link or a session.",
		);
		assert.equal(
			view("needs_you", false),
			"Nothing needs you right now. Your projects show up here when they need a price or a session.",
		);
		assert.equal(view("needs_you", true, "proofs"), "Nothing left here.");
		assert.equal(view("active", true, "on_client"), "Nothing left here.");
		assert.equal(view("quoted"), "No projects here right now.");
		assert.equal(view("closed"), "No closed projects yet.");
	});

	test("a page past the last has its own sentence, in every view", ({
		assert,
	}) => {
		for (const filter of ["active", "needs_you", "quoted", "closed"]) {
			assert.equal(
				view(filter, true, null, { current: 99, last: 2 }),
				"There's nothing on this page.",
				filter,
			);
		}
		assert.equal(
			view("needs_you", true, "proofs", { current: 3, last: 1 }),
			"There's nothing on this page.",
		);
	});
});

test.group("tableCaption and the waiting words", () => {
	test("the caption says the order", ({ assert }) => {
		assert.equal(
			tableCaption({ filter: "active", waiting: null, sort: "needs" }, null),
			"Your projects, what needs you first",
		);
		assert.equal(
			tableCaption({ filter: "quoted", waiting: null, sort: "contact" }, null),
			"Your projects, the longest since last contact first",
		);
		assert.equal(
			tableCaption({ filter: "closed", waiting: null, sort: null }, null),
			"Closed projects, the latest change first",
		);
		assert.equal(
			tableCaption({ filter: "needs_you", waiting: null, sort: null }, null),
			"What needs you, the longest wait first",
		);
		assert.equal(
			tableCaption(
				{ filter: "needs_you", waiting: "proofs", sort: null },
				"Payment screenshots to check",
			),
			"Payment screenshots to check, the longest wait first",
		);
	});

	test("the waiting header goes back to the chip it sits under", ({
		assert,
	}) => {
		assert.deepEqual(backLink("proofs"), {
			label: "Show all that needs you",
			status: "needs_you",
		});
		assert.deepEqual(backLink("on_client"), {
			label: "Show all active projects",
			status: "active",
		});
		assert.equal(ON_CLIENT_TITLE, "Waiting on clients");
	});

	test("the two sorts are named", ({ assert }) => {
		assert.deepEqual(SORT_LABELS, {
			needs: "What needs you",
			contact: "Last contact",
		});
	});
});
