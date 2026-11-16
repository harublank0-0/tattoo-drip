import { Link } from "@inertiajs/react";
import { cn } from "cn";
import { urlFor } from "~/client";

const ITEMS = [
	{ key: "studios", label: "Studios", href: urlFor("admin.studios") },
	{ key: "reports", label: "Review reports", href: urlFor("admin.reports") },
	{ key: "metrics", label: "Pilot metrics", href: urlFor("admin.metrics") },
	{ key: "accounts", label: "Accounts", href: urlFor("admin.accounts") },
	{
		key: "billing",
		label: "TattooDrip billing",
		href: urlFor("admin.billing"),
	},
	{
		key: "payments",
		label: "Studio payment connections",
		href: urlFor("admin.payments"),
	},
] as const;

/**
 * The platform admin pages' sub-nav; `current` is the page being shown.
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
