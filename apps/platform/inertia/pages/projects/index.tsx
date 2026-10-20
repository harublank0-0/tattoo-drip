import { Link } from "@inertiajs/react";
import { urlFor } from "~/client";
import Page from "~/components/page";
import {
	ACTIVE_FILTERS,
	PROOF_WAITING_STATUS,
	type ProjectListProps,
	STATUS_LABELS,
} from "~/components/projects";
import StatusBadge from "~/components/status_badge";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/**
 * The studio's projects, filtered by status (TAT-46). Owners see every
 * project, artists the ones assigned to them; the server decides.
 */
export default function ProjectsIndex({
	filter,
	counts,
	projects,
	page,
}: ProjectListProps) {
	const tenant = useTenant();
	const base = urlFor("tenant.projects.index", { tenant: tenant.slug });
	const href = (status: string, pageNumber = 1) =>
		`${base}?status=${status}${pageNumber > 1 ? `&page=${pageNumber}` : ""}`;
	const chips = [
		{ value: "active", label: "Active", count: counts.active },
		...ACTIVE_FILTERS.map((status) => ({
			value: status,
			label: STATUS_LABELS[status] ?? status,
			count: counts.byStatus[status] ?? 0,
		})),
		{ value: "closed", label: "Closed", count: counts.closed },
	];

	return (
		<Page
			title="Projects"
			actions={
				<Link
					href={urlFor("tenant.projects.create", { tenant: tenant.slug })}
					className={buttonVariants({ className: "h-11" })}
				>
					Book session
				</Link>
			}
		>
			<nav aria-label="Filter projects" className="flex flex-wrap gap-2">
				{chips.map((chip) => (
					<Link
						key={chip.value}
						href={href(chip.value)}
						preserveScroll
						aria-current={chip.value === filter ? "page" : undefined}
						className={buttonVariants({
							variant: chip.value === filter ? "default" : "outline",
							size: "sm",
						})}
					>
						{chip.label}
						<span className="tabular-nums opacity-70">{chip.count}</span>
					</Link>
				))}
			</nav>

			{projects.length === 0 ? (
				<p className="text-sm text-muted-foreground">No projects here.</p>
			) : (
				<ul className="flex flex-col divide-y rounded-md border">
					{projects.map((project) => (
						<li key={project.id}>
							<Link
								href={urlFor("tenant.projects.show", {
									tenant: tenant.slug,
									id: project.id,
								})}
								className="flex flex-col gap-1 px-4 py-3 hover:bg-muted/50"
							>
								<span className="flex flex-wrap items-center justify-between gap-2">
									<span className="font-medium">
										{project.clientName ?? "Unknown client"}
									</span>
									<span className="flex flex-wrap items-center gap-2">
										{project.proofWaiting && (
											<StatusBadge status={PROOF_WAITING_STATUS} />
										)}
										{project.depositToSettle && (
											<Badge variant="outline">deposit to settle</Badge>
										)}
										{project.quoteLapsed && (
											<Badge variant="outline">quote expired</Badge>
										)}
										{project.balanceOwed && (
											<Badge variant="outline">balance due</Badge>
										)}
										{project.noSession && (
											<Badge variant="destructive">no session</Badge>
										)}
										<StatusBadge status={project.status} />
									</span>
								</span>
								<span className="text-sm text-muted-foreground">
									{project.artistName
										? `with ${project.artistName}`
										: "no artist"}{" "}
									· {project.contactedText}
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}

			{page.last > 1 && (
				<nav aria-label="Pages" className="flex justify-between text-sm">
					{page.current > 1 ? (
						<Link href={href(filter, page.current - 1)} preserveScroll>
							Previous
						</Link>
					) : (
						<span />
					)}
					{page.current < page.last ? (
						<Link href={href(filter, page.current + 1)} preserveScroll>
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

ProjectsIndex.layout = [AppLayout];
