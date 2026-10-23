import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `TodayModule` below restates its shape and the inertia project type-checks the real one.
import * as todayModule from "../../../inertia/components/today.js";

type Section = "needsYou" | "sessions" | "waiting";
type More = {
	route: "tenant.inbox.index" | "tenant.projects.index";
	waiting: string | null;
};
type TodayModule = {
	GROUP_TITLES: Record<string, string>;
	moreText(group: { count: number; more: More }): string;
	emptyText(section: Section, role: string, scope?: string): string;
	setupFirst(page: { setup: unknown; needsYou: unknown[] }): boolean;
};
const { GROUP_TITLES, moreText, emptyText, setupFirst } =
	todayModule as TodayModule;

test.group("Today copy", () => {
	test("the six groups are titled in page order", ({ assert }) => {
		assert.deepEqual(Object.entries(GROUP_TITLES), [
			["proofs", "Payment screenshots to check"],
			["requests", "New requests"],
			["prices", "Prices to send"],
			["ending", "Prices ending soon"],
			["deposits", "Deposits to chase"],
			["sessions", "Sessions to book"],
		]);
	});

	test("See all names where it goes", ({ assert }) => {
		assert.equal(
			moreText({
				count: 7,
				more: { route: "tenant.inbox.index", waiting: null },
			}),
			"See all 7 in the Inbox",
		);
		assert.equal(
			moreText({
				count: 12,
				more: { route: "tenant.projects.index", waiting: "prices" },
			}),
			"See all 12 on Projects",
		);
	});

	test("every empty section says so in plain words, for each role", ({
		assert,
	}) => {
		assert.equal(
			emptyText("needsYou", "owner"),
			"Nothing needs you right now. New requests and payment screenshots show up here.",
		);
		assert.equal(
			emptyText("needsYou", "artist"),
			"Nothing needs you right now. Your projects show up here when they need a price or a session.",
		);
		assert.equal(
			emptyText("sessions", "owner", "studio"),
			"No sessions today.",
		);
		assert.equal(
			emptyText("sessions", "artist", "artist"),
			"No sessions for you today.",
		);
		assert.equal(
			emptyText("sessions", "artist", "unlinked"),
			"Your account isn't linked to an artist profile yet, so no sessions show here. Ask an owner to link it.",
		);
		assert.equal(
			emptyText("waiting", "owner"),
			"Nobody to chase. Prices and deposit links you send wait here until the client answers.",
		);
		assert.equal(
			emptyText("waiting", "artist"),
			"Nobody to chase. Prices you send wait here until the client answers.",
		);
	});

	test("the setup checklist leads only when nothing needs you", ({
		assert,
	}) => {
		const setup = { complete: false };
		assert.isTrue(setupFirst({ setup, needsYou: [] }));
		assert.isFalse(setupFirst({ setup, needsYou: [{}] }));
		assert.isFalse(setupFirst({ setup: null, needsYou: [] }));
	});
});
