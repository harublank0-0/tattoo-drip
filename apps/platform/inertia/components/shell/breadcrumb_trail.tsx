import { Link } from "@adonisjs/inertia/react";
import { usePage } from "@inertiajs/react";
import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { urlFor } from "~/client";
import { breadcrumbs } from "~/components/shell/breadcrumbs";
import type { ShellNavItem } from "~/components/shell/nav_items";

/**
 * Where the page sits (the desktop top bar): the destination it is under,
 * linked while the page is below it, then the page itself. Built from the
 * route (`breadcrumbs`), so no page keeps its own copy.
 */
export default function Breadcrumbs({
	items,
	tenantSlug,
}: {
	items: ShellNavItem[];
	tenantSlug: string;
}) {
	const { component, url } = usePage();
	const crumbs = breadcrumbs(
		component,
		url,
		items.map((item) => ({
			label: item.label,
			href: urlFor(item.route, { tenant: tenantSlug }),
			also: item.also,
		})),
	);
	if (crumbs.length === 0) return null;

	return (
		<nav aria-label="Breadcrumb" className="min-w-0">
			<ol className="flex min-w-0 items-center gap-1.5 text-sm">
				{crumbs.map((crumb, index) => (
					<Fragment key={crumb.label}>
						{index > 0 && (
							<li aria-hidden="true" className="text-muted-foreground">
								<ChevronRight className="size-3.5" />
							</li>
						)}
						<li className="min-w-0">
							{crumb.href ? (
								<Link
									href={crumb.href}
									className="rounded-sm text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
								>
									{crumb.label}
								</Link>
							) : (
								<span
									aria-current="page"
									className="font-medium text-foreground"
								>
									{crumb.label}
								</span>
							)}
						</li>
					</Fragment>
				))}
			</ol>
		</nav>
	);
}
