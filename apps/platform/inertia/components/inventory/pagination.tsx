import { Link } from "@inertiajs/react";
import { buttonVariants } from "~/components/ui/button";

export default function InventoryPagination({
	page,
	lastPage,
	href,
}: {
	page: number;
	lastPage: number;
	href: (page: number) => string;
}) {
	if (lastPage <= 1 && page <= 1) return null;
	return (
		<nav
			aria-label="Pagination"
			className="flex flex-wrap items-center justify-between gap-3 pt-3 text-sm"
		>
			<span className="text-muted-foreground">
				Page {page} of {Math.max(1, lastPage)}
			</span>
			<div className="flex gap-2">
				{page > 1 && (
					<Link
						href={href(Math.min(page - 1, Math.max(1, lastPage)))}
						className={buttonVariants({ variant: "outline" })}
					>
						Previous
					</Link>
				)}
				{page < lastPage && (
					<Link
						href={href(page + 1)}
						className={buttonVariants({ variant: "outline" })}
					>
						Next
					</Link>
				)}
			</div>
		</nav>
	);
}
