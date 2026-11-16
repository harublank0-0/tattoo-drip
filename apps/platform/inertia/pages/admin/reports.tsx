import { Link } from "@inertiajs/react";
import { urlFor } from "~/client";
import {
	KeepItUp,
	type ReasonOption,
	ReviewTakedownForm,
} from "~/components/admin_moderation";
import AdminNav from "~/components/admin_nav";
import Page from "~/components/page";
import Section from "~/components/section";
import AppLayout from "~/layouts/app";

type Props = {
	reports: {
		studioSlug: string;
		studioName: string;
		reviewId: string;
		reportedText: string;
		reason: string;
		reasonLabel: string;
		note: string | null;
		rating: number | null;
		shownName: string;
		body: string;
	}[];
	takedownReasons: ReasonOption[];
};

/**
 * Studios' open reports of client reviews, oldest first, across every
 * studio. Taking a reported review down closes its report. Everything
 * studio- or client-typed is plain text.
 */
export default function AdminReports({ reports, takedownReasons }: Props) {
	return (
		<Page
			title="Review reports"
			description="Studios' open reports of client reviews, oldest first."
			actions={<AdminNav current="reports" />}
		>
			<Section title="Open reports">
				{reports.length === 0 ? (
					<p className="text-sm text-muted-foreground">No open reports.</p>
				) : (
					<ul className="divide-y">
						{reports.map((report) => (
							<li
								key={report.reviewId}
								className="flex flex-col gap-2 py-3 text-sm"
							>
								<Link
									href={urlFor("admin.studios.show", {
										slug: report.studioSlug,
									})}
									className="font-medium underline underline-offset-4"
								>
									{report.studioName}
								</Link>
								<span className="font-medium">
									{report.shownName}
									{report.rating !== null ? `, ${report.rating}/5` : ""}
								</span>
								<span>{report.body}</span>
								<span className="text-muted-foreground">
									Reported {report.reportedText} for {report.reasonLabel}
									{report.note ? `: ${report.note}` : ""}
								</span>
								<ReviewTakedownForm
									kind="review"
									id={report.reviewId}
									idPrefix={`report-${report.reviewId}`}
									reasons={takedownReasons}
									defaultReason={report.reason}
								/>
								<KeepItUp reviewId={report.reviewId} />
							</li>
						))}
					</ul>
				)}
			</Section>
		</Page>
	);
}

AdminReports.layout = [AppLayout];
