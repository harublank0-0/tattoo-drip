import { Link } from "@adonisjs/inertia/react";
import { usePage } from "@inertiajs/react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { urlFor } from "~/client";
import { isCurrentPath } from "~/components/shell/nav_items";

export type NavRoute = Parameters<typeof urlFor>[0];
export type NavParams = Parameters<typeof urlFor>[1];

export type NavItem = {
	label: string;
	route: NavRoute;
	/** Route parameters, e.g. `{ tenant: "black-needle" }` for tenant pages. */
	params?: NavParams;
	/** Only active on the route itself, not on nested URLs. */
	exact?: boolean;
	icon?: LucideIcon;
	/** A count shown next to the label, e.g. new inquiries. */
	badge?: number;
};

/**
 * A link that marks itself with `aria-current="page"` when the current URL
 * matches its route. By default nested URLs count as a match, so a
 * "Settings" link stays active on "/settings/security". Pass `exact` to
 * only match the route itself.
 */
export default function NavLink({
	route,
	params,
	exact = false,
	also,
	label,
	className,
	children,
}: {
	route: NavRoute;
	params?: NavParams;
	exact?: boolean;
	/** Other path prefixes that also make the link current. */
	also?: string[];
	/** The link's accessible name when its content isn't enough (the bell, TAT-52). */
	label?: string;
	className?: string;
	children: ReactNode;
}) {
	const { url } = usePage();
	const href = urlFor(route, params);
	const isActive = isCurrentPath(url, href, { exact, also });

	return (
		<Link
			href={href}
			className={className}
			aria-current={isActive ? "page" : undefined}
			aria-label={label}
		>
			{children}
		</Link>
	);
}
