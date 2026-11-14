import { isCurrentPath } from "./nav_items.js";

/**
 * The top bar's breadcrumbs (Studio OS), from the page's route, never from
 * what each page says about itself: the destination the page sits under (the
 * same `isCurrentPath` rule that marks it in the sidebar), then the page's
 * own name when it is below that destination. Plain data, so the unit tests
 * can load it.
 */
export type Crumb = { label: string; href?: string };

export type CrumbSection = { label: string; href: string; also?: string[] };

/**
 * The name of each page that sits below a destination, by its Inertia
 * component. A destination's own page (Today, the Inbox, the lists) has no
 * entry: its crumb is the destination itself.
 */
export const PAGE_LABELS: Record<string, string> = {
	"inquiries/show": "Request",
	"projects/new": "Book a session",
	"projects/show": "Project",
	"clients/show": "Client",
	"clients/edit": "Edit client",
	"artists/form": "Artist profile",
	"settings/profile": "Studio profile",
	"settings/look": "Page look",
	"settings/good_to_know": "Good to know",
	"settings/faq_policies": "FAQ & policies",
	"settings/discover": "Discover",
	"settings/discover_preview": "Discover preview",
	"settings/payments": "Payments",
	"settings/payment_method_form": "Payment method",
	"settings/online_payments": "Online payments",
	"settings/billing": "Billing",
	"settings/messages": "Messages",
	"settings/members": "Members",
	"alerts/index": "Alerts",
};

/**
 * Pages outside every destination a member has, by component: an artist's
 * own profile (artists have no Artists item).
 */
const OUTSIDE_LABELS: Record<string, string> = {
	"artists/form": "Your artist profile",
	"account/show": "Your account",
	"admin/billing": "TattooDrip billing",
	"admin/payments": "Studio payment connections",
};

/**
 * The crumbs for `component` at `url`: the section (a link while the page is
 * below it) and the page's name; the last crumb is the current page and has
 * no link. Empty when neither is known.
 */
export function breadcrumbs(
	component: string,
	url: string,
	sections: CrumbSection[],
): Crumb[] {
	const section = sections.find(({ href, also }) =>
		isCurrentPath(url, href, { also }),
	);
	const page = PAGE_LABELS[component];
	if (!section) {
		const outside = OUTSIDE_LABELS[component] ?? page;
		return outside ? [{ label: outside }] : [];
	}
	const onSection = isCurrentPath(url, section.href, { exact: true });
	if (!page || onSection) return [{ label: section.label }];
	return [{ label: section.label, href: section.href }, { label: page }];
}
