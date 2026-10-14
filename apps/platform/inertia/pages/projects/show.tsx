import Page from "~/components/page";
import {
	type ProjectPageProps,
	type QuoteProps,
	STATUS_LABELS,
} from "~/components/projects";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import AppLayout from "~/layouts/app";

/**
 * One project: its brief, current quote and earlier versions (TAT-64).
 * TAT-46 grows it into the full project screen.
 */
export default function ProjectShow({
	project,
	quote,
	history,
}: ProjectPageProps) {
	return (
		<Page
			title={project.clientName ?? "Project"}
			description={
				project.artistName ? `With ${project.artistName}` : "No artist yet"
			}
		>
			<div className="flex max-w-2xl flex-col gap-6">
				<Card>
					<CardContent className="flex flex-col gap-3">
						<Badge variant="secondary">
							{STATUS_LABELS[project.status] ?? project.status}
						</Badge>
						<p className="text-sm whitespace-pre-line">{project.brief}</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Quote</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						{quote ? (
							<QuoteSummary quote={quote} />
						) : (
							<p className="text-sm text-muted-foreground">No quote yet.</p>
						)}
					</CardContent>
				</Card>

				{history.length > 0 && (
					<Card>
						<CardHeader>
							<CardTitle>Earlier versions</CardTitle>
						</CardHeader>
						<CardContent>
							<ul className="flex flex-col divide-y text-sm">
								{history.map((old) => (
									<li
										key={old.id}
										className="flex flex-wrap justify-between gap-2 py-2"
									>
										<span>
											Version {old.version}: {old.totalText}, deposit{" "}
											{old.depositText}
										</span>
										<span className="text-muted-foreground">
											Issued {old.issuedText}, valid until {old.validUntilText}
										</span>
									</li>
								))}
							</ul>
						</CardContent>
					</Card>
				)}
			</div>
		</Page>
	);
}

function QuoteSummary({ quote }: { quote: QuoteProps }) {
	return (
		<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
			<dt className="text-muted-foreground">Version</dt>
			<dd>{quote.version}</dd>
			<dt className="text-muted-foreground">Price</dt>
			<dd>
				{quote.priceText}
				{quote.kind === "hourly" && ` ≈ ${quote.totalText}`}
			</dd>
			<dt className="text-muted-foreground">Deposit</dt>
			<dd>{quote.depositText}</dd>
			<dt className="text-muted-foreground">Valid until</dt>
			<dd className="flex items-center gap-2">
				{quote.validUntilText}
				{quote.expired && <Badge variant="destructive">Expired</Badge>}
			</dd>
			<dt className="text-muted-foreground">Issued</dt>
			<dd>{quote.issuedText}</dd>
		</dl>
	);
}

ProjectShow.layout = [AppLayout];
