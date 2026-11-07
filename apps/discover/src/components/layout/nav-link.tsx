import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { NavLink as NavLinkItem } from "#/lib/routes";

/**
 * One navigation item: a router link inside Discover (aria-current and the
 * `data-status="active"` style on its own page), or a plain link to Studio
 * OS on its own origin.
 */
export function NavLink({
	item,
	className,
	onNavigate,
	children,
}: {
	item: NavLinkItem;
	className?: string;
	/** Called when the link is followed: the mobile menu closes itself with it. */
	onNavigate?: () => void;
	children?: ReactNode;
}) {
	if (item.kind === "external") {
		return (
			<a href={item.href} className={className} onClick={onNavigate}>
				{children ?? item.label}
			</a>
		);
	}
	return (
		<Link
			to={item.to}
			className={className}
			onClick={onNavigate}
			activeOptions={{ exact: item.to === "/", includeSearch: false }}
		>
			{children ?? item.label}
		</Link>
	);
}
