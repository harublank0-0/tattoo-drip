/**
 * The dashboard's main destinations (TAT-67, TAT-107): one list, rendered as
 * the phone's bottom tab bar (with a More menu for the rest) and the desktop
 * sidebar. Plain data with no imports, so the unit tests can load it. A new
 * area is one more entry here.
 */
export type NavKey =
	| "today"
	| "inbox"
	| "projects"
	| "calendar"
	| "clients"
	| "artists"
	| "settings";

export type ShellNavItem = {
	key: NavKey;
	label: string;
	route:
		| "tenant.today"
		| "tenant.inbox.index"
		| "tenant.projects.index"
		| "tenant.calendar.index"
		| "tenant.clients.index"
		| "tenant.artists"
		| "tenant.settings";
	/** "bar": its own tab on the phone; "more": under More on the phone. The sidebar lists both. */
	place: "bar" | "more";
	/** A count on the item (new requests, projects that need you); absent unless above zero. */
	badge?: number;
	/** What the badge counts, read by screen readers after the number: "new" when absent. */
	badgeLabel?: string;
	/** Other path prefixes that also make this item current. */
	also?: string[];
};

/** The shell's counts (TAT-107): new requests (owners) and the projects that need the member. */
export type NavCounts = { inbox: number | null; today: number | null };

const counted = (count: number | null, badgeLabel?: string) =>
	count !== null && count > 0
		? { badge: count, ...(badgeLabel ? { badgeLabel } : {}) }
		: {};

/**
 * What `tenant`'s member sees (TAT-107): Today, Inbox (owners), Projects and
 * Calendar, and for owners Clients, Artists and Settings under More. Nothing
 * is counted twice: the Inbox counts new requests, Today the projects that
 * need the member, and the bell (not an item) the alerts neither counts. The
 * server 404s the rest anyway.
 */
export function navItems(
	tenant: { slug: string; role: string },
	counts: NavCounts,
): ShellNavItem[] {
	const owner = tenant.role === "owner";
	const items: ShellNavItem[] = [
		{
			key: "today",
			label: "Today",
			route: "tenant.today",
			place: "bar",
			...counted(counts.today, "need you"),
		},
	];
	if (owner) {
		items.push({
			key: "inbox",
			label: "Inbox",
			route: "tenant.inbox.index",
			place: "bar",
			...counted(counts.inbox),
		});
	}
	items.push(
		{
			key: "projects",
			label: "Projects",
			route: "tenant.projects.index",
			place: "bar",
		},
		{
			key: "calendar",
			label: "Calendar",
			route: "tenant.calendar.index",
			place: "bar",
		},
	);
	if (owner) {
		items.push(
			{
				key: "clients",
				label: "Clients",
				route: "tenant.clients.index",
				place: "more",
			},
			{
				key: "artists",
				label: "Artists",
				route: "tenant.artists",
				place: "more",
			},
			{
				key: "settings",
				label: "Settings",
				route: "tenant.settings",
				place: "more",
			},
		);
	}
	return items;
}

/** The phone's tabs, and the items More opens (none: no More tab). */
export function tabBarItems(items: ShellNavItem[]) {
	return {
		tabs: items.filter(({ place }) => place === "bar"),
		more: items.filter(({ place }) => place === "more"),
	};
}

/** The tab bar only earns its space with two or more destinations. */
export function showTabBar(items: ShellNavItem[]): boolean {
	return items.length >= 2;
}

/**
 * Whether `url` (the current page; a query string or trailing slash is
 * fine) is `href` or below it, or below one of `also`. Whole path
 * segments only, so "/t/a/inbox" is not current on "/t/a/inboxes".
 * `exact` matches `href` itself only.
 */
export function isCurrentPath(
	url: string,
	href: string,
	{ exact = false, also = [] }: { exact?: boolean; also?: string[] } = {},
): boolean {
	const path = url.split("?")[0].replace(/(.)\/+$/, "$1");
	if (exact) return path === href;
	const under = (prefix: string) =>
		path === prefix || path.startsWith(`${prefix}/`);
	return under(href) || also.some(under);
}
