import { Link } from "@inertiajs/react";
import { cn } from "cn";

const ITEMS = [
	{ key: "studios", label: "Studios", href: "/admin/studios" },
	{ key: "reports", label: "Review reports", href: "/admin/reports" },
	{ key: "metrics", label: "Pilot metrics", href: "/admin/metrics" },
	{ key: "accounts", label: "Accounts", href: "/admin/accounts" },
	{ key: "billing", label: "TattooDrip billing", href: "/admin/billing" },
	{
		key: "payments",
		label: "Studio payment connections",
		href: "/admin/payments",
	},
] as const;

/**
 * The platform admin pages' sub-nav; `current` is the page being shown.
 * Plain hrefs until every admin route exists (then `urlFor`).
 */
export default function AdminNav({
	current,
}: {
	current: (typeof ITEMS)[number]["key"];
}) {
	return (
		<nav aria-label="Admin" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
			{ITEMS.map((item) => (
				<Link
					key={item.key}
					href={item.href}
					aria-current={item.key === current ? "page" : undefined}
					className={cn(
						"underline-offset-4 hover:underline",
						item.key === current
							? "font-medium underline"
							: "text-muted-foreground",
					)}
				>
					{item.label}
				</Link>
			))}
		</nav>
	);
}
