import { Link } from "@inertiajs/react";
import { urlFor } from "~/client";
import { flashRowLabel } from "~/components/flash";
import type { InboxListProps } from "~/components/inquiries";
import Page from "~/components/page";
import StatusBadge from "~/components/status_badge";
import StudioLinkCard from "~/components/studio_link_card";
import { buttonVariants } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/**
 * The inquiry inbox (TAT-46): new inquiries waiting for a decision, oldest
 * first, and the decided ones. Owners only. The setup checklist and the
 * pilot numbers live on Today (TAT-107).
 */
export default function InboxIndex({
	view,
	studioPage,
	newCount,
	inquiries,
	page,
}: InboxListProps) {
	const tenant = useTenant();
	const base = urlFor("tenant.inbox.index", { tenant: tenant.slug });
	const href = (tab: string, pageNumber = 1) =>
		`${base}?view=${tab}${pageNumber > 1 ? `&page=${pageNumber}` : ""}`;
	const tabs = [
		{ value: "new", label: `New (${newCount})` },
		{ value: "decided", label: "Decided" },
	];

	return (
		<Page title="Inbox">
			<nav aria-label="Inbox views" className="flex gap-2">
				{tabs.map((tab) => (
					<Link
						key={tab.value}
						href={href(tab.value)}
						aria-current={tab.value === view ? "page" : undefined}
						className={buttonVariants({
							variant: tab.value === view ? "default" : "outline",
							size: "sm",
						})}
					>
						{tab.label}
					</Link>
				))}
			</nav>

			{inquiries.length === 0 && view === "new" && studioPage ? (
				<Card>
					<CardHeader>
						<CardTitle>Your studio page</CardTitle>
						<CardDescription>
							No new inquiries yet. Clients send them from this link: put it in
							your Instagram bio.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<StudioLinkCard studioPage={studioPage} />
					</CardContent>
				</Card>
			) : inquiries.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{view === "new"
						? "No new inquiries. They arrive here from the studio page."
						: "Nothing decided yet."}
				</p>
			) : (
				<ul className="flex flex-col divide-y rounded-md border">
					{inquiries.map((inquiry) => (
						<li
							key={inquiry.id}
							className="flex items-center gap-2 pr-4 hover:bg-muted/50"
						>
							<Link
								href={urlFor("tenant.inbox.show", {
									tenant: tenant.slug,
									id: inquiry.id,
								})}
								className="flex min-w-0 flex-1 flex-col gap-1 px-4 py-3"
							>
								<span className="flex flex-wrap items-center justify-between gap-2">
									<span className="font-medium">{inquiry.contactName}</span>
									{view === "new" ? (
										<span className="text-sm text-muted-foreground">
											{inquiry.receivedText}
										</span>
									) : (
										<span className="flex items-center gap-2 text-sm">
											<StatusBadge status={inquiry.status} />
											<span className="text-muted-foreground">
												{inquiry.decidedOn}
											</span>
										</span>
									)}
								</span>
								{view === "new" && (
									<>
										{inquiry.flash && (
											<span className="flex items-center gap-2 text-sm font-medium">
												<img
													src={inquiry.flash.thumbnailUrl}
													alt=""
													width={40}
													height={40}
													loading="lazy"
													decoding="async"
													className="size-10 shrink-0 rounded-md border bg-muted object-contain"
												/>
												<span className="min-w-0 wrap-anywhere" dir="auto">
													{flashRowLabel(inquiry.flash.name)}
												</span>
											</span>
										)}
										<span className="line-clamp-2 text-sm">{inquiry.idea}</span>
										<span className="text-sm text-muted-foreground">
											{inquiry.placement} · {inquiry.approximateSize} ·{" "}
											{inquiry.preferredArtistName ?? "any artist"}
											{inquiry.references > 0 &&
												` · ${inquiry.references} reference${inquiry.references === 1 ? "" : "s"}`}
										</span>
										{inquiry.contactedText && (
											<span className="text-sm text-muted-foreground">
												{inquiry.contactedText}
											</span>
										)}
									</>
								)}
							</Link>
							{view === "decided" && inquiry.projectId && (
								<Link
									href={urlFor("tenant.projects.show", {
										tenant: tenant.slug,
										id: inquiry.projectId,
									})}
									className={buttonVariants({ variant: "outline", size: "sm" })}
								>
									View project
								</Link>
							)}
						</li>
					))}
				</ul>
			)}

			{page.last > 1 && (
				<nav aria-label="Pages" className="flex justify-between text-sm">
					{page.current > 1 ? (
						<Link
							href={href(view, page.current - 1)}
							className="-my-3 flex min-h-11 items-center"
						>
							Previous
						</Link>
					) : (
						<span />
					)}
					{page.current < page.last ? (
						<Link
							href={href(view, page.current + 1)}
							className="-my-3 flex min-h-11 items-center"
						>
							Next
						</Link>
					) : (
						<span />
					)}
				</nav>
			)}
		</Page>
	);
}

InboxIndex.layout = [AppLayout];
