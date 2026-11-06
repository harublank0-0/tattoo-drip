import { Link } from "@inertiajs/react";
import { cn } from "cn";
import { CalendarPlus, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { urlFor } from "~/client";
import {
	type ClientListProps,
	type ClientRow,
	clientsHref,
} from "~/components/clients";
import Initials from "~/components/initials";
import Page from "~/components/page";
import { Button, buttonVariants } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

const FILTERS = [
	{ value: "all", label: "All clients" },
	{ value: "upcoming", label: "With a session to come" },
] as const;

/**
 * The studio's clients (TAT-41, Studio OS): a CRM directory, newest first,
 * searched on the server by name, phone or email and filtered to those with
 * a session to come; the address holds the search, the filter and the page,
 * so a view can be kept or shared. A table from `md`, rows on a phone; each
 * client opens their profile. Clients come from requests and bookings, so
 * there is no "add client": "Book a session" makes one. Owners only.
 */
export default function ClientsIndex({
	search,
	filter,
	clients,
	page,
}: ClientListProps) {
	const tenant = useTenant();
	const base = urlFor("tenant.clients.index", { tenant: tenant.slug });
	const href = (change: { filter?: string; page?: number }) =>
		clientsHref(base, {
			search,
			filter: change.filter ?? filter,
			page: change.page ?? 1,
		});
	const profile = (row: ClientRow) =>
		urlFor("tenant.clients.show", { tenant: tenant.slug, id: row.id });
	const book = (row: ClientRow) =>
		row.phone
			? `${urlFor("tenant.projects.create", { tenant: tenant.slug })}?phone=${encodeURIComponent(row.phone)}`
			: null;

	return (
		<Page
			title="Clients"
			description={
				page.total === 0
					? "Everyone who sends a request or is booked."
					: `${page.total} client${page.total === 1 ? "" : "s"}${search || filter !== "all" ? " match" : ""}`
			}
		>
			<div className="flex flex-col gap-3 border-y py-3 md:flex-row md:items-center">
				<search className="min-w-0 flex-1">
					<form method="get" action={base} className="flex gap-2">
						{filter !== "all" && (
							<input type="hidden" name="filter" value={filter} />
						)}
						<div className="relative min-w-0 flex-1">
							<Search
								aria-hidden="true"
								className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								type="search"
								name="q"
								defaultValue={search}
								placeholder="Name, phone or email"
								aria-label="Search clients by name, phone or email"
								className="pl-9"
							/>
						</div>
						<Button type="submit" variant="outline">
							Search
						</Button>
						{search && (
							<Link
								href={clientsHref(base, { search: "", filter, page: 1 })}
								className="flex items-center px-1 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground max-lg:min-h-11"
							>
								Clear
							</Link>
						)}
					</form>
				</search>
				<nav
					aria-label="Filter clients"
					className="inline-flex self-start rounded-md border bg-background p-0.5"
				>
					{FILTERS.map((option) => (
						<Link
							key={option.value}
							href={href({ filter: option.value })}
							aria-current={option.value === filter ? "page" : undefined}
							className="inline-flex min-h-8 items-center rounded-sm px-3 text-sm font-medium text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:bg-accent aria-[current=page]:text-foreground max-lg:min-h-11"
						>
							{option.label}
						</Link>
					))}
				</nav>
			</div>

			{clients.length === 0 ? (
				<p className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
					{search
						? `No clients match "${search}". Search by name, phone (3 digits or more) or email.`
						: filter === "upcoming"
							? "No client has a session to come."
							: "No clients yet. They appear when a request arrives or you book a session."}
				</p>
			) : (
				<>
					<div className="hidden overflow-hidden rounded-lg border bg-card md:block">
						<table className="w-full text-sm">
							<caption className="sr-only">
								Clients, newest first. Each name opens the client's profile.
							</caption>
							<thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
								<tr>
									<th scope="col" className="px-4 py-2.5 font-medium">
										Client
									</th>
									<th scope="col" className="px-4 py-2.5 font-medium">
										Phone
									</th>
									<th
										scope="col"
										className="px-4 py-2.5 text-right font-medium"
									>
										Projects
									</th>
									<th scope="col" className="px-4 py-2.5 font-medium">
										Next session
									</th>
									<th scope="col" className="px-4 py-2.5 font-medium">
										Last activity
									</th>
									<th scope="col" className="w-0 px-4 py-2.5">
										<span className="sr-only">Actions</span>
									</th>
								</tr>
							</thead>
							<tbody className="divide-y">
								{clients.map((row) => (
									<tr
										key={row.id}
										className="transition-colors duration-150 hover:bg-accent/40 focus-within:bg-accent/40"
									>
										<td className="px-4 py-3">
											<div className="flex items-center gap-3">
												<Initials name={row.name} />
												<div className="flex min-w-0 flex-col">
													{/* The name is the row's link (no clickable row, as on Projects). */}
													<Link
														href={profile(row)}
														className="rounded-sm font-medium wrap-anywhere underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
													>
														{row.name}
													</Link>
													{row.email && (
														<span className="text-xs text-muted-foreground wrap-anywhere">
															{row.email}
														</span>
													)}
												</div>
											</div>
										</td>
										<td className="px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums">
											{row.phone ?? "Deleted"}
										</td>
										<td className="px-4 py-3 text-right tabular-nums">
											{row.projects}
										</td>
										<td className="px-4 py-3 text-muted-foreground">
											{row.nextSessionText ?? "None booked"}
										</td>
										<td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
											{upperFirst(row.lastActivityText)}
										</td>
										<td className="px-4 py-2 text-right">
											{book(row) && (
												<Link
													href={book(row) as string}
													aria-label={`Book a session for ${row.name}`}
													title="Book a session"
													className={cn(
														buttonVariants({
															variant: "ghost",
															size: "icon-sm",
														}),
														"text-muted-foreground hover:text-foreground",
													)}
												>
													<CalendarPlus aria-hidden="true" />
												</Link>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					<ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card md:hidden">
						{clients.map((row) => (
							<li key={row.id}>
								<Link
									href={profile(row)}
									className="flex min-h-11 items-start gap-3 px-4 py-3 outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
								>
									<Initials name={row.name} />
									<span className="flex min-w-0 flex-1 flex-col gap-0.5">
										<span className="font-medium wrap-anywhere">
											{row.name}
										</span>
										<span className="text-sm text-muted-foreground tabular-nums">
											{row.phone ?? "Details deleted"}
										</span>
										<span className="text-sm text-muted-foreground">
											{row.nextSessionText
												? `Next: ${row.nextSessionText}`
												: `${row.projects} project${row.projects === 1 ? "" : "s"}, active ${row.lastActivityText}`}
										</span>
									</span>
								</Link>
							</li>
						))}
					</ul>
				</>
			)}

			{page.last > 1 && (
				<nav
					aria-label="Pages"
					className="flex items-center justify-between gap-2 text-sm"
				>
					{page.current > 1 ? (
						<Link
							href={href({ page: page.current - 1 })}
							className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
						>
							<ChevronLeft aria-hidden="true" />
							Previous
						</Link>
					) : (
						<span />
					)}
					<span className="text-muted-foreground tabular-nums">
						Page {page.current} of {page.last}
					</span>
					{page.current < page.last ? (
						<Link
							href={href({ page: page.current + 1 })}
							className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
						>
							Next
							<ChevronRight aria-hidden="true" />
						</Link>
					) : (
						<span />
					)}
				</nav>
			)}
		</Page>
	);
}

ClientsIndex.layout = [AppLayout];

function upperFirst(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
