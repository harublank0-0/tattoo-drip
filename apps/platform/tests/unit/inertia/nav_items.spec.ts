import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `NavModule` below restates its shape and the inertia project type-checks the real one.
import * as navModule from "../../../inertia/components/shell/nav_items.js";

type Item = {
	key: string;
	label: string;
	route: string;
	badge?: number;
	also?: string[];
};
type NavModule = {
	navItems(
		tenant: { slug: string; role: string },
		inboxCount: number | null,
	): Item[];
	showTabBar(items: Item[]): boolean;
	isCurrentPath(
		url: string,
		href: string,
		options?: { exact?: boolean; also?: string[] },
	): boolean;
};
const { isCurrentPath, navItems, showTabBar } = navModule as NavModule;

const owner = { slug: "bnt", role: "owner" };
const artist = { slug: "bnt", role: "artist" };

test.group("navItems", () => {
	test("owners get Inbox, Projects and Settings; artists get Projects", ({
		assert,
	}) => {
		assert.deepEqual(
			navItems(owner, 0).map(({ key }) => key),
			["inbox", "projects", "clients", "settings"],
		);
		assert.deepEqual(
			navItems(artist, null).map(({ key }) => key),
			["projects"],
		);
	});

	test("the Inbox badge shows only above zero", ({ assert }) => {
		const inbox = (count: number | null) =>
			navItems(owner, count).find(({ key }) => key === "inbox");

		assert.equal(inbox(3)?.badge, 3);
		assert.notProperty(inbox(0), "badge");
		assert.notProperty(inbox(null), "badge");
		assert.isTrue(navItems(artist, 5).every((item) => !("badge" in item)));
	});

	test("Settings also covers the artist pages of this studio", ({ assert }) => {
		const settings = navItems(owner, 0).find(({ key }) => key === "settings");
		assert.deepEqual(settings?.also, ["/t/bnt/artists"]);
	});

	test("the tab bar needs two or more destinations", ({ assert }) => {
		assert.isTrue(showTabBar(navItems(owner, 0)));
		assert.isFalse(showTabBar(navItems(artist, 0)));
	});
});

test.group("isCurrentPath", () => {
	test("matches the page and the pages below it, by whole segments", ({
		assert,
	}) => {
		assert.isTrue(isCurrentPath("/t/bnt/inbox", "/t/bnt/inbox"));
		assert.isTrue(isCurrentPath("/t/bnt/inbox/", "/t/bnt/inbox"));
		assert.isTrue(isCurrentPath("/t/bnt/inbox?view=decided", "/t/bnt/inbox"));
		assert.isTrue(isCurrentPath("/t/bnt/inbox/0199", "/t/bnt/inbox"));
		assert.isFalse(isCurrentPath("/t/bnt/inboxes", "/t/bnt/inbox"));
		assert.isFalse(isCurrentPath("/t/bnt2/inbox", "/t/bnt/inbox"));
	});

	test("exact matches only the page itself", ({ assert }) => {
		assert.isTrue(isCurrentPath("/t/bnt", "/t/bnt", { exact: true }));
		assert.isFalse(isCurrentPath("/t/bnt/inbox", "/t/bnt", { exact: true }));
	});

	test("also adds other prefixes", ({ assert }) => {
		const also = ["/t/bnt/artists"];
		assert.isTrue(
			isCurrentPath("/t/bnt/artists/new", "/t/bnt/settings", { also }),
		);
		assert.isTrue(
			isCurrentPath("/t/bnt/settings/payments", "/t/bnt/settings", { also }),
		);
		assert.isFalse(
			isCurrentPath("/t/bnt/artistsx", "/t/bnt/settings", { also }),
		);
	});
});
