import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * A studio's or an artist's link (`profileDestination`): Discover's own
 * profile through the router (D08), or, for an external destination, a
 * plain link to the studio's site.
 */
export function ProfileLink({
	destination,
	className,
	children,
}: {
	destination: { href: string; external: boolean };
	className?: string;
	children: ReactNode;
}) {
	return destination.external ? (
		<a href={destination.href} className={className}>
			{children}
		</a>
	) : (
		<Link to={destination.href} className={className}>
			{children}
		</Link>
	);
}
