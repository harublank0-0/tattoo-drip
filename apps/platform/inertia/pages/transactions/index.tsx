import { Link, router } from "@inertiajs/react";
import { Download, Receipt } from "lucide-react";
import { type ReactNode, useState } from "react";
import { urlFor } from "~/client";
import InventoryPagination from "~/components/inventory/pagination";
import Page from "~/components/page";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "~/components/ui/sheet";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

type Row = {
	id: string;
	type: string;
	typeText: string;
	status: string;
	statusText: string;
	providerText: string;
	online: boolean;
	amount: number;
	amountText: string;
	dateText: string;
	timeText: string;
	createdText: string;
	paidText: string | null;
	refundedText: string | null;
	projectId: string;
	projectBrief: string | null;
	clientId: string | null;
	clientName: string | null;
	note: string | null;
	providerRef: string | null;
	providerId: string | null;
	problem: string | null;
	checkable: boolean;
};

type Option = { value: string; label: string };

type Props = {
	filters: {
		from: string;
		to: string;
		status: string | null;
		provider: string | null;
		type: string | null;
		q: string | null;
		page: number;
	};
	periodText: string;
	rows: Row[];
	pagination: { page: number; lastPage: number; total: number };
	totals: {
		currency: string;
		gross: string;
		refunds: string;
		reversals: string | null;
		net: string;
		collectedCount: number;
		pending: string;
		started: string;
		review: string | null;
	}[];
	daily: {
		day: string;
		dayText: string;
		collected: string;
		refunded: string | null;
		share: number;
	}[];
	options: { statuses: Option[]; providers: Option[]; types: Option[] };
};

const selectClass = "h-11 w-full rounded-md border bg-background px-3 text-sm";

function statusVariant(status: string) {
	if (status === "succeeded") return "secondary" as const;
	if (status === "review" || status === "failed") return "destructive" as const;
	return "outline" as const;
}

/**
 * The studio's Transactions (owners): customer-side money only, never
 * TattooDrip's subscription billing. Amounts are collected amounts, not
 * bank settlements: the providers report no payouts.
 */
export default function TransactionsIndex({
	filters,
	periodText,
	rows,
	pagination,
	totals,
	daily,
	options,
}: Props) {
	const { slug } = useTenant();
	const params = { tenant: slug };
	const index = urlFor("tenant.transactions.index", params);
	const query = (page?: number) => {
		const search = new URLSearchParams();
		search.set("from", filters.from);
		search.set("to", filters.to);
		if (filters.status) search.set("status", filters.status);
		if (filters.provider) search.set("provider", filters.provider);
		if (filters.type) search.set("type", filters.type);
		if (filters.q) search.set("q", filters.q);
		if (page && page > 1) search.set("page", String(page));
		return search.toString();
	};
	const exportHref = `${urlFor("tenant.transactions.export", params)}?${query()}`;
	const [open, setOpen] = useState<Row | null>(null);
	const [checking, setChecking] = useState(false);

	const check = (row: Row) => {
		setChecking(true);
		router.post(
			urlFor("tenant.transactions.sync", { ...params, id: row.id }),
			{},
			{
				preserveScroll: true,
				onFinish: () => {
					setChecking(false);
					setOpen(null);
				},
			},
		);
	};

	return (
		<Page
			title="Transactions"
			description="Money your clients paid you and what you gave back, at the desk and online."
			actions={
				<a
					href={exportHref}
					className={buttonVariants({ variant: "outline" })}
					download
				>
					<Download data-icon="inline-start" />
					Export CSV
				</a>
			}
		>
			<Section title="Income" description={periodText}>
				{totals.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						Nothing collected or pending in this period.
					</p>
				) : (
					totals.map((t) => (
						<div key={t.currency} className="flex flex-col gap-4">
							<dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
								<Stat
									label="Gross collected"
									value={t.gross}
									hint={`${t.collectedCount} payment${t.collectedCount === 1 ? "" : "s"}`}
								/>
								<Stat label="Refunds" value={t.refunds} />
								<Stat
									label="Net collected"
									value={t.net}
									strong
									hint={
										t.reversals
											? `After reversals of ${t.reversals}`
											: undefined
									}
								/>
								<Stat
									label="Pending"
									value={t.pending}
									hint="Waiting for a check or confirmation; not income yet"
								/>
							</dl>
							<p className="text-sm text-muted-foreground">
								Online checkouts started and not paid: {t.started}.
								{t.review && (
									<>
										{" "}
										<span className="text-destructive">
											{t.review} in online payments needs review.
										</span>
									</>
								)}{" "}
								Collected amounts are what clients paid, not bank settlements.
							</p>
						</div>
					))
				)}
				{daily.length > 0 && (
					<div className="mt-6">
						<h3 className="mb-2 text-sm font-medium">
							Collected per day (NPR)
						</h3>
						<ul className="flex flex-col gap-1" aria-label="Collected per day">
							{daily.map((d) => (
								<li
									key={d.day}
									className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-sm"
								>
									<span className="text-muted-foreground">{d.dayText}</span>
									<span
										className="h-2 rounded-full bg-muted"
										aria-hidden="true"
									>
										<span
											className="block h-2 rounded-full bg-primary"
											style={{ width: `${d.share}%` }}
										/>
									</span>
									<span className="tabular-nums">
										{d.collected}
										{d.refunded && (
											<span className="text-muted-foreground">
												{" "}
												· −{d.refunded}
											</span>
										)}
									</span>
								</li>
							))}
						</ul>
					</div>
				)}
			</Section>

			<Section title="Records">
				<form
					method="get"
					action={index}
					className="mb-4 grid grid-cols-2 items-end gap-2 sm:grid-cols-3 lg:grid-cols-7"
				>
					<label
						htmlFor="transactions-search"
						className="col-span-2 flex flex-col gap-2 text-sm font-medium sm:col-span-3 lg:col-span-2"
					>
						Search
						<Input
							id="transactions-search"
							className="h-11"
							type="search"
							name="q"
							placeholder="Client, project or provider reference"
							defaultValue={filters.q ?? ""}
							maxLength={100}
						/>
					</label>
					<label
						htmlFor="transactions-from"
						className="flex flex-col gap-2 text-sm font-medium"
					>
						From
						<Input
							id="transactions-from"
							className="h-11"
							type="date"
							name="from"
							defaultValue={filters.from}
						/>
					</label>
					<label
						htmlFor="transactions-to"
						className="flex flex-col gap-2 text-sm font-medium"
					>
						To
						<Input
							id="transactions-to"
							className="h-11"
							type="date"
							name="to"
							defaultValue={filters.to}
						/>
					</label>
					<FilterSelect
						name="status"
						label="Status"
						value={filters.status}
						options={options.statuses}
					/>
					<FilterSelect
						name="provider"
						label="Paid with"
						value={filters.provider}
						options={options.providers}
					/>
					<FilterSelect
						name="type"
						label="Type"
						value={filters.type}
						options={options.types}
					/>
					<div className="col-span-2 flex gap-2 sm:col-span-3 lg:col-span-7">
						<Button type="submit" variant="outline">
							Filter
						</Button>
						<Link href={index} className={buttonVariants({ variant: "ghost" })}>
							Reset
						</Link>
					</div>
				</form>

				{rows.length === 0 ? (
					<Empty className="border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Receipt />
							</EmptyMedia>
							<EmptyTitle>No transactions here</EmptyTitle>
							<EmptyDescription>
								Nothing matches these filters in {periodText}. Payments you
								record or clients send show up here.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<ul className="divide-y" aria-label="Transactions">
						{rows.map((row) => (
							<li key={`${row.id}`}>
								<button
									type="button"
									onClick={() => setOpen(row)}
									className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 py-3 text-left hover:bg-muted/50"
								>
									<span className="min-w-0 wrap-anywhere">
										<span className="block font-medium">
											{row.typeText}
											{row.clientName && ` · ${row.clientName}`}
										</span>
										<span className="block text-sm text-muted-foreground">
											{row.dateText}, {row.timeText} · {row.providerText}
											{row.online && " · online"}
										</span>
									</span>
									<span className="flex flex-wrap items-center gap-2 text-sm">
										<Badge variant={statusVariant(row.status)}>
											{row.statusText}
										</Badge>
										<span className="font-medium tabular-nums">
											{row.amountText}
										</span>
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
				<InventoryPagination
					page={pagination.page}
					lastPage={pagination.lastPage}
					href={(next) => `${index}?${query(next)}`}
				/>
			</Section>

			<Sheet
				open={open !== null}
				onOpenChange={(next) => !next && setOpen(null)}
			>
				<SheetContent side="right" busy={checking} className="overflow-y-auto">
					{open && (
						<>
							<SheetHeader>
								<SheetTitle>
									{open.typeText}: {open.amountText}
								</SheetTitle>
								<SheetDescription>
									{open.statusText} · {open.providerText}
									{open.online && " · paid online"}
								</SheetDescription>
							</SheetHeader>
							<dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 text-sm">
								<Detail label="Client">
									{open.clientId && open.clientName ? (
										<Link
											href={urlFor("tenant.clients.show", {
												...params,
												id: open.clientId,
											})}
											className="underline underline-offset-4"
										>
											{open.clientName}
										</Link>
									) : (
										(open.clientName ?? "—")
									)}
								</Detail>
								<Detail label="Project">
									<Link
										href={`${urlFor("tenant.projects.show", { ...params, id: open.projectId })}#payments`}
										className="underline underline-offset-4 wrap-anywhere"
									>
										{open.projectBrief?.slice(0, 80) ?? "Open the project"}
									</Link>
								</Detail>
								<Detail label="Created">{open.createdText}</Detail>
								<Detail label="Paid">{open.paidText ?? "—"}</Detail>
								{open.refundedText && (
									<Detail label="Refunded">{open.refundedText}</Detail>
								)}
								{open.providerRef && (
									<Detail label="Provider ref.">
										<span className="font-mono wrap-anywhere">
											{open.providerRef}
										</span>
									</Detail>
								)}
								{open.providerId && (
									<Detail label="PayBridgeNP id">
										<span className="font-mono wrap-anywhere">
											{open.providerId}
										</span>
									</Detail>
								)}
								{open.note && <Detail label="Note">{open.note}</Detail>}
								{open.problem && (
									<Detail label="Problem">
										<span className="text-destructive">{open.problem}</span>
									</Detail>
								)}
							</dl>
							{open.checkable && (
								<div className="px-4 py-4">
									<Button
										type="button"
										className="h-11 w-full sm:w-auto"
										disabled={checking}
										onClick={() => check(open)}
									>
										{checking ? "Checking…" : "Check status with PayBridgeNP"}
									</Button>
									<p className="mt-2 text-sm text-muted-foreground">
										Asks PayBridgeNP once for this payment and its refunds.
									</p>
								</div>
							)}
						</>
					)}
				</SheetContent>
			</Sheet>
		</Page>
	);
}

function Stat({
	label,
	value,
	hint,
	strong = false,
}: {
	label: string;
	value: string;
	hint?: string;
	strong?: boolean;
}) {
	return (
		<div className="rounded-md border p-3">
			<dt className="text-sm text-muted-foreground">{label}</dt>
			<dd
				className={
					strong ? "text-lg font-semibold tabular-nums" : "text-lg tabular-nums"
				}
			>
				{value}
			</dd>
			{hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
		</div>
	);
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
	return (
		<>
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="min-w-0">{children}</dd>
		</>
	);
}

function FilterSelect({
	name,
	label,
	value,
	options,
}: {
	name: string;
	label: string;
	value: string | null;
	options: Option[];
}) {
	return (
		<label className="flex flex-col gap-2 text-sm font-medium">
			{label}
			<select name={name} defaultValue={value ?? ""} className={selectClass}>
				<option value="">All</option>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</label>
	);
}

TransactionsIndex.layout = [AppLayout];
