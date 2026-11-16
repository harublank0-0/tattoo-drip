import { Link } from "@inertiajs/react";
import { ArrowLeft } from "lucide-react";
import { urlFor } from "~/client";
import CopyLinkButton from "~/components/copy_link_button";
import {
	HISTORY_STATUS_LABELS,
	type HistoryCounts,
	type HistoryStatus,
	historyCountsText,
	historyQuery,
	historyVariant,
	monthLabel,
} from "~/components/design_lab";
import Page from "~/components/page";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

type HistoryRow = {
	id: string;
	status: HistoryStatus;
	attempt: number | null;
	reason: string | null;
	thumbnailUrl: string | null;
	person: string;
	project: { id: string; title: string } | null;
	when: string;
	reference: string | null;
};

type Filters = {
	month: string;
	artist: string | null;
	status: HistoryStatus | null;
};

const selectClass =
	"min-h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm lg:min-h-9";

/**
 * The owners' generation history (docs/design-lab.md, "History"): every
 * attempt in the studio, read-only, for keeping an eye on usage and
 * failures. A failed or blocked row has a reference to send to support.
 */
export default function DesignLabHistory({
	rows,
	filters,
	page,
	lastPage,
	months,
	artists,
	counts,
	limit,
	studio,
}: {
	rows: HistoryRow[];
	filters: Filters;
	page: number;
	lastPage: number;
	months: string[];
	artists: { id: string; label: string }[];
	counts: HistoryCounts;
	limit: number | null;
	studio: { used: number; limit: number } | null;
}) {
	const { slug } = useTenant();
	const base = urlFor("tenant.design_lab.history", { tenant: slug });
	const currentMonth = months[0] ?? filters.month;
	const pageHref = (next: number) =>
		`${base}${historyQuery(filters, next, currentMonth)}`;

	return (
		<Page
			title="Design Lab history"
			description="Every generation attempt in your studio, for keeping an eye on usage and failures."
			actions={
				<Link
					href={urlFor("tenant.design_lab.index", { tenant: slug })}
					className="flex min-h-11 items-center gap-1 text-sm"
				>
					<ArrowLeft aria-hidden="true" className="size-4" />
					Back to AI Design Lab
				</Link>
			}
		>
			<Section title="Filters">
				<form
					// Paging is a visit to this same page: remount so the selects
					// show the filters applied, never a choice left unsubmitted.
					key={[filters.month, filters.artist, filters.status, page].join("|")}
					method="get"
					action={base}
					className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end"
				>
					<label className="flex flex-col gap-2 text-sm font-medium">
						Month
						<select
							name="month"
							defaultValue={filters.month}
							className={selectClass}
						>
							{months.map((month) => (
								<option key={month} value={month}>
									{monthLabel(month)}
								</option>
							))}
						</select>
					</label>
					<label className="flex flex-col gap-2 text-sm font-medium">
						Artist
						<select
							name="artist"
							defaultValue={filters.artist ?? ""}
							className={selectClass}
						>
							<option value="">Everyone</option>
							{artists.map((artist) => (
								<option key={artist.id} value={artist.id}>
									{artist.label}
								</option>
							))}
						</select>
					</label>
					<label className="flex flex-col gap-2 text-sm font-medium">
						Status
						<select
							name="status"
							defaultValue={filters.status ?? ""}
							className={selectClass}
						>
							<option value="">All</option>
							{(Object.keys(HISTORY_STATUS_LABELS) as HistoryStatus[]).map(
								(status) => (
									<option key={status} value={status}>
										{HISTORY_STATUS_LABELS[status]}
									</option>
								),
							)}
						</select>
					</label>
					<Button type="submit" variant="outline">
						Show
					</Button>
				</form>
				<p className="mt-3 text-xs text-muted-foreground">
					Months follow the allowance's calendar (UTC), so a generation late on
					a month's last evening can count toward the next month.
				</p>
			</Section>

			<Section
				title={monthLabel(filters.month)}
				description={
					<>
						<span className="block">{historyCountsText(counts, limit)}</span>
						{studio && (
							<span className="block">
								Studio: {studio.used} of {studio.limit} used this month
							</span>
						)}
					</>
				}
			>
				{rows.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No generations match these filters.
					</p>
				) : (
					<ul className="flex flex-col divide-y rounded-lg border">
						{rows.map((row) => (
							<li
								key={row.id}
								className="grid gap-3 p-3 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,12rem)] sm:items-start"
							>
								<div className="flex items-center gap-2 sm:flex-col sm:items-start">
									<Badge variant={historyVariant(row.status)}>
										{HISTORY_STATUS_LABELS[row.status]}
									</Badge>
									{row.attempt !== null && (
										<span className="text-xs text-muted-foreground">
											Attempt {row.attempt}
										</span>
									)}
								</div>
								<div className="flex min-w-0 flex-col gap-2">
									{row.thumbnailUrl && (
										// Not lazy: a 5-minute signed URL must not expire
										// before it is seen (as on the project list).
										<img
											src={row.thumbnailUrl}
											alt=""
											className="size-16 rounded border bg-muted object-contain"
										/>
									)}
									{row.reason && (
										<p className="text-sm wrap-anywhere">{row.reason}</p>
									)}
									{row.status === "in_progress" && (
										<p className="text-sm text-muted-foreground">
											Still being generated.
										</p>
									)}
									{row.reference && (
										<div className="flex flex-wrap items-center gap-2">
											<code className="select-all rounded bg-muted px-1.5 py-0.5 text-xs wrap-anywhere">
												{row.reference}
											</code>
											<CopyLinkButton
												text={row.reference}
												label="Copy reference"
												copiedText="Reference copied."
												failedText="Couldn't copy: select the reference instead."
												variant="outline"
											/>
										</div>
									)}
								</div>
								<div className="flex min-w-0 flex-col gap-1 text-sm">
									<span className="wrap-anywhere">{row.person}</span>
									{row.project ? (
										<Link
											href={urlFor("tenant.design_lab.show", {
												tenant: slug,
												id: row.project.id,
											})}
											className="wrap-anywhere underline"
										>
											{row.project.title}
										</Link>
									) : (
										<span className="text-muted-foreground">
											(deleted project)
										</span>
									)}
									<span className="text-xs text-muted-foreground">
										{row.when}
									</span>
								</div>
							</li>
						))}
					</ul>
				)}
				{lastPage > 1 && (
					<nav
						aria-label="Pages"
						className="mt-4 flex items-center justify-between text-sm"
					>
						{page > 1 ? (
							<Link
								href={pageHref(page - 1)}
								className="-my-3 flex min-h-11 items-center"
							>
								Previous
							</Link>
						) : (
							<span />
						)}
						<span className="text-muted-foreground">
							Page {page} of {lastPage}
						</span>
						{page < lastPage ? (
							<Link
								href={pageHref(page + 1)}
								className="-my-3 flex min-h-11 items-center"
							>
								Next
							</Link>
						) : (
							<span />
						)}
					</nav>
				)}
			</Section>
		</Page>
	);
}

DesignLabHistory.layout = [AppLayout];
