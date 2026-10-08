import { Link } from "@adonisjs/inertia/react";
import { usePage } from "@inertiajs/react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { urlFor } from "~/client";

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
	className,
	children,
}: {
	route: NavRoute;
	params?: NavParams;
	exact?: boolean;
	className?: string;
	children: ReactNode;
}) {
	const { url } = usePage();
	const href = urlFor(route, params);
	const path = url.split("?")[0];
	const isActive = exact
		? path === href
		: path === href || path.startsWith(`${href}/`);

	return (
		<Link
			href={href}
			className={className}
			aria-current={isActive ? "page" : undefined}
		>
			{children}
		</Link>
	);
}
