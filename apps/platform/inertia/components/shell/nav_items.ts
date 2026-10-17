/**
 * The dashboard's main destinations (TAT-67): one list, rendered as the
 * phone's bottom tab bar and the desktop sidebar. Plain data with no
 * imports, so the unit tests can load it. A new area is one more entry here.
 */
export type NavKey = "inbox" | "projects" | "calendar" | "clients" | "settings";

export type ShellNavItem = {
	key: NavKey;
	label: string;
	route:
		| "tenant.inbox.index"
		| "tenant.projects.index"
		| "tenant.calendar.index"
		| "tenant.clients.index"
		| "tenant.settings";
	/** New inquiries on the Inbox; absent unless above zero. */
	badge?: number;
	/** Other path prefixes that also make this item current. */
	also?: string[];
};

/**
 * What `tenant`'s member sees: owners get Inbox, Projects, Calendar, Clients
 * and Settings (the artist pages count as Settings); artists get Projects and
 * Calendar. The server 404s the rest anyway.
 */
export function navItems(
	tenant: { slug: string; role: string },
	inboxCount: number | null,
): ShellNavItem[] {
	const owner = tenant.role === "owner";
	const items: ShellNavItem[] = [];
	if (owner) {
		items.push({
			key: "inbox",
			label: "Inbox",
			route: "tenant.inbox.index",
			...(inboxCount && inboxCount > 0 ? { badge: inboxCount } : {}),
		});
	}
	items.push({
		key: "projects",
		label: "Projects",
		route: "tenant.projects.index",
	});
	items.push({
		key: "calendar",
		label: "Calendar",
		route: "tenant.calendar.index",
	});
	if (owner) {
		items.push(
			{
				key: "clients",
				label: "Clients",
				route: "tenant.clients.index",
			},
			{
				key: "settings",
				label: "Settings",
				route: "tenant.settings",
				also: [`/t/${tenant.slug}/artists`],
			},
		);
	}
	return items;
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
