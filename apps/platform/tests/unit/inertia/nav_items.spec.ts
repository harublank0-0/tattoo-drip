import { test } from "@japa/runner";
import { rolesFor } from "#modules/tenancy/access";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `NavModule` below restates its shape and the inertia project type-checks the real one.
import * as navModule from "../../../inertia/components/shell/nav_items.js";

type Item = {
	key: string;
	label: string;
	route: string;
	place: "bar" | "more";
	badge?: number;
	badgeLabel?: string;
	also?: string[];
};
type Counts = { inbox: number | null; today: number | null };
type NavModule = {
	navItems(tenant: { slug: string; role: string }, counts: Counts): Item[];
	tabBarItems(items: Item[]): { tabs: Item[]; more: Item[] };
	showTabBar(items: Item[]): boolean;
	isCurrentPath(
		url: string,
		href: string,
		options?: { exact?: boolean; also?: string[] },
	): boolean;
};
const { isCurrentPath, navItems, showTabBar, tabBarItems } =
	navModule as NavModule;

const owner = { slug: "bnt", role: "owner" };
const artist = { slug: "bnt", role: "artist" };
const none: Counts = { inbox: null, today: null };

test.group("navItems", () => {
	test("owners get Today, Inbox, Projects and Calendar, with Clients, Artists and Settings under More; artists get Today, Projects and Calendar", ({
		assert,
	}) => {
		assert.deepEqual(
			navItems(owner, none).map(({ key, place }) => [key, place]),
			[
				["today", "bar"],
				["inbox", "bar"],
				["projects", "bar"],
				["calendar", "bar"],
				["clients", "more"],
				["artists", "more"],
				["settings", "more"],
			],
		);
		assert.deepEqual(
			navItems(artist, none).map(({ key, place }) => [key, place]),
			[
				["today", "bar"],
				["projects", "bar"],
				["calendar", "bar"],
			],
		);
		assert.deepEqual(
			navItems(artist, none).find(({ key }) => key === "calendar"),
			{
				key: "calendar",
				label: "Calendar",
				route: "tenant.calendar.index",
				place: "bar",
			},
		);
	});

	test("every destination a member sees is a route their role may use (TAT-30)", ({
		assert,
	}) => {
		for (const role of ["owner", "artist"] as const) {
			for (const item of navItems(
				{ slug: "bnt", role },
				{ inbox: 3, today: 2 },
			)) {
				assert.include(
					rolesFor(item.route) ?? [],
					role,
					`${role}: ${item.route}`,
				);
			}
		}
	});

	test("the Inbox badge counts new requests, only above zero and only for owners", ({
		assert,
	}) => {
		const inbox = (count: number | null) =>
			navItems(owner, { inbox: count, today: 0 }).find(
				({ key }) => key === "inbox",
			);

		assert.equal(inbox(3)?.badge, 3);
		assert.notProperty(inbox(3), "badgeLabel");
		assert.notProperty(inbox(0), "badge");
		assert.notProperty(inbox(null), "badge");
		assert.isUndefined(
			navItems(artist, { inbox: 5, today: 0 }).find(
				({ key }) => key === "inbox",
			),
		);
	});

	test("the Today badge counts the projects that need the member, for both roles, read as 'need you'", ({
		assert,
	}) => {
		const today = (role: string, count: number | null) =>
			navItems({ slug: "bnt", role }, { inbox: 0, today: count }).find(
				({ key }) => key === "today",
			);

		for (const role of ["owner", "artist"]) {
			assert.deepEqual(today(role, 3), {
				key: "today",
				label: "Today",
				route: "tenant.today",
				place: "bar",
				badge: 3,
				badgeLabel: "need you",
			});
			assert.notProperty(today(role, 0), "badge");
			assert.notProperty(today(role, null), "badge");
		}
	});

	test("no other item carries a badge: nothing is counted twice", ({
		assert,
	}) => {
		for (const tenant of [owner, artist]) {
			const withBadge = navItems(tenant, { inbox: 4, today: 5 })
				.filter((item) => "badge" in item)
				.map(({ key }) => key);
			assert.deepEqual(
				withBadge,
				tenant === owner ? ["today", "inbox"] : ["today"],
			);
		}
	});

	test("Settings no longer covers the artist pages: Artists is its own item", ({
		assert,
	}) => {
		const items = navItems(owner, none);
		assert.notProperty(
			items.find(({ key }) => key === "settings"),
			"also",
		);
		assert.deepEqual(
			items.find(({ key }) => key === "artists"),
			{
				key: "artists",
				label: "Artists",
				route: "tenant.artists",
				place: "more",
			},
		);
	});

	test("the tab bar splits the phone's tabs from the items More opens", ({
		assert,
	}) => {
		const owners = tabBarItems(navItems(owner, none));
		assert.deepEqual(
			owners.tabs.map(({ key }) => key),
			["today", "inbox", "projects", "calendar"],
		);
		assert.deepEqual(
			owners.more.map(({ key }) => key),
			["clients", "artists", "settings"],
		);
		const artists = tabBarItems(navItems(artist, none));
		assert.deepEqual(
			artists.tabs.map(({ key }) => key),
			["today", "projects", "calendar"],
		);
		assert.deepEqual(artists.more, []);
	});

	test("the tab bar needs two or more destinations", ({ assert }) => {
		assert.isTrue(showTabBar(navItems(owner, none)));
		assert.isTrue(showTabBar(navItems(artist, none)));
		assert.isFalse(showTabBar(navItems(artist, none).slice(0, 1)));
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
