import { Head, Link } from "@inertiajs/react";
import { SocialIcon } from "@tattoo-drip/react/social-icon";
import { cn } from "cn";
import { CalendarPlus, Pencil, Phone } from "lucide-react";
import type { ReactNode } from "react";
import { urlFor } from "~/client";
import { calendarHref } from "~/components/calendar";
import type { ClientPageProps } from "~/components/clients";
import Initials from "~/components/initials";
import { KIND_LABELS, PAYMENT_STATUS_LABELS } from "~/components/payments";
import { SESSION_KIND_LABELS } from "~/components/projects";
import ReferenceGrid from "~/components/references";
import SessionStatusBadge from "~/components/session_status_badge";
import StatusBadge from "~/components/status_badge";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/**
 * One client (TAT-41, Studio OS): a CRM record. The header has who they are,
 * how to reach them and what to do next (book, edit, message); the sections
 * below, reached from the row of links under it, are their sessions (every
 * status, newest first, each opening the calendar drawer), projects,
 * requests, payments and references. What the client sent (their requests,
 * references) and what the studio keeps (notes, payments) stay apart. Owners
 * only; a client whose details were deleted shows none and can't be edited.
 */
export default function ClientShow({
	client,
	links,
	projects,
	inquiries,
	references,
	payments,
	sessions,
	sessionsCapped,
}: ClientPageProps) {
	const tenant = useTenant();
	const calendar = urlFor("tenant.calendar.index", { tenant: tenant.slug });
	const project = (id: string) =>
		urlFor("tenant.projects.show", { tenant: tenant.slug, id });
	const upcoming = sessions.filter((session) => session.upcoming).length;
	const sections = [
		{ id: "sessions", label: "Sessions", count: sessions.length },
		{ id: "projects", label: "Projects", count: projects.length },
		{ id: "requests", label: "Requests", count: inquiries.length },
		{ id: "payments", label: "Payments", count: payments.rows.length },
		{ id: "references", label: "References", count: references.length },
	];

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-6 pb-12 sm:px-6 sm:pt-8 sm:pb-16 lg:px-8">
			<Head title={client.name} />
			<header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex min-w-0 items-start gap-4">
					<Initials name={client.name} className="size-14 text-base" />
					<div className="flex min-w-0 flex-col gap-1">
						<h1 className="text-[1.625rem] leading-[1.35] font-semibold text-balance wrap-anywhere sm:text-[1.75rem]">
							{client.name}
						</h1>
						{client.anonymized ? (
							<p className="text-sm text-muted-foreground">
								This client's details were deleted.
							</p>
						) : (
							<p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
								{client.phone && (
									<span className="tabular-nums">{client.phone}</span>
								)}
								{client.email && (
									<span className="wrap-anywhere">{client.email}</span>
								)}
								<span>Client since {client.sinceText}</span>
							</p>
						)}
						{upcoming > 0 && (
							<p className="text-sm font-medium">
								{upcoming} session{upcoming === 1 ? "" : "s"} to come
							</p>
						)}
					</div>
				</div>
				{!client.anonymized && (
					<div className="flex flex-wrap gap-2">
						{client.phone && (
							<Link
								href={`${urlFor("tenant.projects.create", { tenant: tenant.slug })}?phone=${encodeURIComponent(client.phone)}`}
								className={buttonVariants({ size: "sm" })}
							>
								<CalendarPlus aria-hidden="true" />
								Book session
							</Link>
						)}
						<Link
							href={urlFor("tenant.clients.edit", {
								tenant: tenant.slug,
								id: client.id,
							})}
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							<Pencil aria-hidden="true" />
							Edit details
						</Link>
					</div>
				)}
			</header>

			{links && (
				<div className="flex flex-wrap gap-2">
					<a
						href={links.whatsapp}
						target="_blank"
						rel="noreferrer"
						className={buttonVariants({ variant: "ghost", size: "sm" })}
					>
						<SocialIcon platform="whatsapp" />
						WhatsApp
					</a>
					<a
						href={links.viber}
						className={buttonVariants({ variant: "ghost", size: "sm" })}
					>
						<SocialIcon platform="viber" />
						Viber
					</a>
					<a
						href={links.call}
						className={buttonVariants({ variant: "ghost", size: "sm" })}
					>
						<Phone aria-hidden="true" />
						Call
					</a>
				</div>
			)}

			<nav
				aria-label="Sections"
				className="-mx-4 flex gap-1 overflow-x-auto border-y px-4 py-1.5 sm:mx-0 sm:px-0"
			>
				{sections.map((section) => (
					<a
						key={section.id}
						href={`#${section.id}`}
						className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-sm font-medium text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 max-lg:min-h-11"
					>
						{section.label}
						<span className="text-xs tabular-nums">{section.count}</span>
					</a>
				))}
			</nav>

			<div className="grid grid-cols-1 items-start gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
				<div className="flex min-w-0 flex-col gap-10">
					<Section id="sessions" title="Sessions" count={sessions.length}>
						{sessions.length === 0 ? (
							<Empty>No sessions yet.</Empty>
						) : (
							<>
								<List>
									{sessions.map((session) => (
										<li key={session.id}>
											<Link
												href={calendarHref(calendar, {
													view: "day",
													date: session.date,
													artist: null,
													status:
														session.status === "cancelled" ||
														session.status === "no_show"
															? "cancelled"
															: "active",
													session: session.id,
												})}
												className={ROW}
											>
												<span className="flex min-w-0 flex-1 flex-col gap-0.5">
													<span className="text-sm font-medium tabular-nums">
														{session.whenText}
													</span>
													<span className="text-sm text-muted-foreground">
														{SESSION_KIND_LABELS[session.kind] ?? session.kind}
														{session.artistName
															? ` with ${session.artistName}`
															: ""}
													</span>
												</span>
												<SessionStatusBadge status={session.status} />
											</Link>
										</li>
									))}
								</List>
								{sessionsCapped && (
									<p className="text-xs text-muted-foreground">
										The latest {sessions.length} are listed. Older ones are on
										each project's page.
									</p>
								)}
							</>
						)}
					</Section>

					<Section id="projects" title="Projects" count={projects.length}>
						{projects.length === 0 ? (
							<Empty>No projects.</Empty>
						) : (
							<List>
								{projects.map((row) => (
									<li key={row.id}>
										<Link href={project(row.id)} className={ROW}>
											<span className="flex min-w-0 flex-1 flex-col gap-0.5">
												<span className="line-clamp-1 text-sm font-medium">
													{row.brief}
												</span>
												<span className="text-sm text-muted-foreground">
													{row.artistName ?? "No artist yet"}, since{" "}
													{row.createdText}
												</span>
											</span>
											<StatusBadge
												status={row.status}
												className="text-xs py-0.5 px-2"
											/>
										</Link>
									</li>
								))}
							</List>
						)}
					</Section>

					<Section
						id="requests"
						title="Requests"
						count={inquiries.length}
						note="What the client sent"
					>
						{inquiries.length === 0 ? (
							<Empty>No requests.</Empty>
						) : (
							<List>
								{inquiries.map((inquiry) => (
									<li key={inquiry.id}>
										<Link
											href={urlFor("tenant.inbox.show", {
												tenant: tenant.slug,
												id: inquiry.id,
											})}
											className={ROW}
										>
											<span className="flex min-w-0 flex-1 flex-col gap-0.5">
												<span className="line-clamp-1 text-sm">
													{inquiry.idea}
												</span>
												<span className="text-sm text-muted-foreground">
													Received {inquiry.receivedText}
												</span>
											</span>
											<StatusBadge
												status={inquiry.status}
												className="text-xs py-0.5 px-2"
											/>
										</Link>
									</li>
								))}
							</List>
						)}
					</Section>

					<Section
						id="references"
						title="References"
						count={references.length}
						note="Images the client sent"
					>
						{references.length === 0 ? (
							<Empty>No references.</Empty>
						) : (
							<ReferenceGrid references={references} />
						)}
					</Section>
				</div>

				<aside className="flex min-w-0 flex-col gap-10">
					<Section id="notes" title="Notes" note="Only the studio sees these">
						<p className="rounded-lg border bg-card px-4 py-3 text-sm whitespace-pre-line wrap-anywhere">
							{client.notes ?? (
								<span className="text-muted-foreground">
									No notes. Add them from Edit details.
								</span>
							)}
						</p>
					</Section>

					<Section id="payments" title="Payments" count={payments.rows.length}>
						<p className="text-sm font-semibold">
							{payments.balanceDueText
								? `Balance due ${payments.balanceDueText}`
								: "Nothing due"}
						</p>
						{payments.rows.length === 0 ? (
							<Empty>No payments yet.</Empty>
						) : (
							<List>
								{payments.rows.map((row) => (
									<li key={row.id}>
										<Link
											href={`${project(row.projectId)}#payments`}
											className={ROW}
										>
											<span className="flex min-w-0 flex-1 flex-col gap-0.5">
												<span className="text-sm font-medium tabular-nums">
													{KIND_LABELS[row.kind]} {row.amountText}
												</span>
												<span className="line-clamp-1 text-sm text-muted-foreground">
													{row.dateText}, {row.projectBrief}
												</span>
											</span>
											<Badge
												variant={
													row.status === "verified" ? "secondary" : "outline"
												}
											>
												{PAYMENT_STATUS_LABELS[row.status]}
											</Badge>
										</Link>
									</li>
								))}
							</List>
						)}
					</Section>
				</aside>
			</div>
		</div>
	);
}

ClientShow.layout = [AppLayout];

const ROW =
	"flex min-h-11 items-start gap-3 px-4 py-3 outline-none transition-colors duration-150 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset";

function Section({
	id,
	title,
	count,
	note,
	children,
}: {
	id: string;
	title: string;
	count?: number;
	note?: string;
	children: ReactNode;
}) {
	return (
		<section
			id={id}
			aria-labelledby={`${id}-title`}
			className="flex min-w-0 scroll-mt-[calc(var(--top-bar-height,3.5rem)+0.5rem)] flex-col gap-3"
		>
			<header className="flex flex-wrap items-baseline gap-x-2">
				<h2 id={`${id}-title`} className="text-base leading-snug font-semibold">
					{title}
					{count !== undefined && (
						<span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
							<span className="sr-only">, </span>
							{count}
						</span>
					)}
				</h2>
				{note && <p className="text-xs text-muted-foreground">{note}</p>}
			</header>
			{children}
		</section>
	);
}

function List({ children }: { children: ReactNode }) {
	return (
		<ul
			className={cn(
				"flex flex-col divide-y overflow-hidden rounded-lg border bg-card",
			)}
		>
			{children}
		</ul>
	);
}

function Empty({ children }: { children: ReactNode }) {
	return (
		<p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
			{children}
		</p>
	);
}
