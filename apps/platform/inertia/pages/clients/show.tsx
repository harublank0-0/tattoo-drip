import { Link } from "@inertiajs/react";
import { urlFor } from "~/client";
import type { ClientPageProps } from "~/components/clients";
import Page from "~/components/page";
import { STATUS_LABELS } from "~/components/projects";
import ReferenceGrid from "~/components/references";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

const INQUIRY_LABELS: Record<string, string> = {
	new: "New",
	accepted: "Accepted",
	declined: "Declined",
};

/** One client: details, notes and everything the studio did with them (TAT-41). */
export default function ClientShow({
	client,
	links,
	projects,
	inquiries,
	references,
}: ClientPageProps) {
	const tenant = useTenant();
	const contact = [client.phone, client.email].filter(Boolean).join(" · ");

	return (
		<Page
			title={client.name}
			description={
				client.anonymized ? "This client's details were deleted." : contact
			}
		>
			<div className="flex max-w-2xl flex-col gap-6">
				{(links || !client.anonymized) && (
					<div className="flex flex-wrap gap-2">
						{links && (
							<>
								<a
									href={links.whatsapp}
									target="_blank"
									rel="noreferrer"
									className={buttonVariants({ variant: "outline" })}
								>
									WhatsApp
								</a>
								<a
									href={links.viber}
									className={buttonVariants({ variant: "outline" })}
								>
									Viber
								</a>
								<a
									href={links.call}
									className={buttonVariants({ variant: "outline" })}
								>
									Call
								</a>
							</>
						)}
						{!client.anonymized && (
							<Link
								href={urlFor("tenant.clients.edit", {
									tenant: tenant.slug,
									id: client.id,
								})}
								className={buttonVariants()}
							>
								Edit details
							</Link>
						)}
						{client.phone && !client.anonymized && (
							<Link
								href={`${urlFor("tenant.projects.create", { tenant: tenant.slug })}?phone=${encodeURIComponent(client.phone)}`}
								className={buttonVariants({ variant: "outline" })}
							>
								Book session
							</Link>
						)}
					</div>
				)}

				<Card>
					<CardHeader>
						<CardTitle>Notes</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-sm whitespace-pre-line break-words">
							{client.notes ?? (
								<span className="text-muted-foreground">No notes.</span>
							)}
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Projects ({projects.length})</CardTitle>
					</CardHeader>
					<CardContent>
						{projects.length === 0 ? (
							<p className="text-sm text-muted-foreground">No projects.</p>
						) : (
							<ul className="flex flex-col divide-y">
								{projects.map((project) => (
									<li key={project.id}>
										<Link
											href={urlFor("tenant.projects.show", {
												tenant: tenant.slug,
												id: project.id,
											})}
											className="flex min-h-11 flex-col gap-1 py-2"
										>
											<span className="line-clamp-1 text-sm font-medium">
												{project.brief}
											</span>
											<span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
												<Badge variant="secondary">
													{STATUS_LABELS[project.status] ?? project.status}
												</Badge>
												{project.artistName ?? "no artist"} ·{" "}
												{project.createdText}
											</span>
										</Link>
									</li>
								))}
							</ul>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Inquiries ({inquiries.length})</CardTitle>
					</CardHeader>
					<CardContent>
						{inquiries.length === 0 ? (
							<p className="text-sm text-muted-foreground">No inquiries.</p>
						) : (
							<ul className="flex flex-col divide-y">
								{inquiries.map((inquiry) => (
									<li key={inquiry.id}>
										<Link
											href={urlFor("tenant.inbox.show", {
												tenant: tenant.slug,
												id: inquiry.id,
											})}
											className="flex min-h-11 flex-col gap-1 py-2"
										>
											<span className="line-clamp-1 text-sm">
												{inquiry.idea}
											</span>
											<span className="text-sm text-muted-foreground">
												{INQUIRY_LABELS[inquiry.status] ?? inquiry.status} ·{" "}
												{inquiry.receivedText}
											</span>
										</Link>
									</li>
								))}
							</ul>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>References</CardTitle>
					</CardHeader>
					<CardContent>
						<ReferenceGrid references={references} />
					</CardContent>
				</Card>

				<p className="text-sm text-muted-foreground">
					Client since {client.sinceText}.
				</p>
			</div>
		</Page>
	);
}

ClientShow.layout = [AppLayout];
