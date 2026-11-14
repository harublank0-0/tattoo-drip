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
	| "inventory"
	| "design_lab"
	| "transactions"
	| "portfolio"
	| "reviews"
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
		| "tenant.inventory.index"
		| "tenant.design_lab.index"
		| "tenant.transactions.index"
		| "tenant.portfolio"
		| "tenant.reviews.index"
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

/**
 * The shell's counts (TAT-107): new requests (owners) and the projects that need the member; and
 * the Fresh ink waiting for the member (Reviews and Fresh ink, slice 2), null while reviews are
 * off, which also hides the Reviews item.
 */
export type NavCounts = {
	inbox: number | null;
	today: number | null;
	reviews?: number | null;
};

const counted = (count: number | null, badgeLabel?: string) =>
	count !== null && count > 0
		? { badge: count, ...(badgeLabel ? { badgeLabel } : {}) }
		: {};

/**
 * What `tenant`'s member sees (TAT-107): Today, Inbox (owners), Projects and
 * Calendar, and for owners Reviews (while reviews are on), Clients, Artists, Portfolio,
 * Inventory, Transactions and Settings under More. An artist has Portfolio (their own work) as a fourth tab,
 * Reviews as a fifth while reviews are on, and Inventory under More when their owner grants
 * access. AI Design Lab is under More for every member while the server has it on
 * (`tenant.designLab`). Nothing
 * is counted twice: the Inbox counts new requests, Today the projects that
 * need the member, and the bell (not an item) the alerts neither counts. The
 * server 404s the rest anyway.
 */
export function navItems(
	tenant: {
		slug: string;
		role: string;
		inventoryAccess?: boolean;
		designLab?: boolean;
	},
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
	const portfolio: ShellNavItem = {
		key: "portfolio",
		label: "Portfolio",
		route: "tenant.portfolio",
		place: owner ? "more" : "bar",
	};
	// Reviews (slice 2): only while reviews are on. Under More for owners (their four tabs stay),
	// a fifth tab for artists; its badge is the Fresh ink waiting for the member.
	const reviews: ShellNavItem | null =
		counts.reviews === null || counts.reviews === undefined
			? null
			: {
					key: "reviews",
					label: "Reviews",
					route: "tenant.reviews.index",
					place: owner ? "more" : "bar",
					...counted(counts.reviews, "waiting"),
				};
	const inventory: ShellNavItem = {
		key: "inventory",
		label: "Inventory",
		route: "tenant.inventory.index",
		place: "more",
	};
	// AI Design Lab: under More for every member, while the server has it on.
	const designLab: ShellNavItem | null = tenant.designLab
		? {
				key: "design_lab",
				label: "AI Design Lab",
				route: "tenant.design_lab.index",
				place: "more",
			}
		: null;
	if (!owner) {
		items.push(portfolio);
		if (reviews) items.push(reviews);
		if (designLab) items.push(designLab);
		if (tenant.inventoryAccess) items.push(inventory);
	}
	if (owner) {
		if (reviews) items.push(reviews);
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
			portfolio,
			...(designLab ? [designLab] : []),
			inventory,
			{
				key: "transactions",
				label: "Transactions",
				route: "tenant.transactions.index",
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

/**
 * The sidebar's groups (Studio OS): the daily work, then running the studio.
 * They follow `place`, because the phone's split is the same one: what has a
 * tab is the work of the day, what sits under More is the studio's set-up.
 * A group with no items is left out.
 */
export const NAV_GROUP_LABELS: Record<ShellNavItem["place"], string> = {
	bar: "Workspace",
	more: "Studio",
};

export function navGroups(
	items: ShellNavItem[],
): { key: ShellNavItem["place"]; label: string; items: ShellNavItem[] }[] {
	return (["bar", "more"] as const)
		.map((key) => ({
			key,
			label: NAV_GROUP_LABELS[key],
			items: items.filter((item) => item.place === key),
		}))
		.filter((group) => group.items.length > 0);
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
