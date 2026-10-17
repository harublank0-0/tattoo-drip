import { Link } from "@inertiajs/react";
import { urlFor } from "~/client";
import type { ClientListProps } from "~/components/clients";
import Page from "~/components/page";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/** The studio's clients (TAT-41), newest first, searchable. Owners only. */
export default function ClientsIndex({
	search,
	clients,
	page,
}: ClientListProps) {
	const tenant = useTenant();
	const base = urlFor("tenant.clients.index", { tenant: tenant.slug });
	const href = (pageNumber: number) => {
		const params = new URLSearchParams();
		if (search) params.set("q", search);
		if (pageNumber > 1) params.set("page", String(pageNumber));
		const query = params.toString();
		return query ? `${base}?${query}` : base;
	};

	return (
		<Page title="Clients">
			<search>
				<form method="get" action={base} className="flex gap-2">
					<Input
						type="search"
						name="q"
						defaultValue={search}
						placeholder="Search name or phone"
						aria-label="Search clients by name or phone"
						className="flex-1"
					/>
					<Button type="submit" variant="outline">
						Search
					</Button>
					{search && (
						<Link href={base} className="self-center text-sm underline">
							Clear
						</Link>
					)}
				</form>
			</search>

			{clients.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{search
						? `No clients match "${search}".`
						: "No clients yet. They appear when an inquiry arrives."}
				</p>
			) : (
				<ul className="flex flex-col divide-y rounded-md border bg-card">
					{clients.map((row) => (
						<li key={row.id}>
							<Link
								href={urlFor("tenant.clients.show", {
									tenant: tenant.slug,
									id: row.id,
								})}
								className="flex min-h-11 flex-col gap-0.5 px-4 py-3 hover:bg-muted/50"
							>
								<span className="font-medium">{row.name}</span>
								<span className="text-sm text-muted-foreground">
									{[
										row.phone,
										row.projects === 0
											? "no projects"
											: `${row.projects} project${row.projects === 1 ? "" : "s"}`,
										`last activity ${row.lastActivityText}`,
									]
										.filter(Boolean)
										.join(" · ")}
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}

			{page.last > 1 && (
				<nav aria-label="Pages" className="flex justify-between text-sm">
					{page.current > 1 ? (
						<Link href={href(page.current - 1)}>Previous</Link>
					) : (
						<span />
					)}
					{page.current < page.last ? (
						<Link href={href(page.current + 1)}>Next</Link>
					) : (
						<span />
					)}
				</nav>
			)}
		</Page>
	);
}

ClientsIndex.layout = [AppLayout];
