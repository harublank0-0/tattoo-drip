import { Link } from "@inertiajs/react";
import { urlFor } from "~/client";
import Page from "~/components/page";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import AppLayout from "~/layouts/app";

type Props = {
	configured: boolean;
	totals: { paidThisMonth: string; paidAllTime: string; outstanding: string };
	studios: {
		tenantId: string;
		name: string;
		planName: string | null;
		statusText: string;
		accessText: string;
	}[];
	invoices: {
		id: string;
		studio: string;
		number: string | null;
		status: string;
		statusText: string;
		amount: string;
		paid: string | null;
		issuedText: string | null;
		paidText: string | null;
	}[];
};

/**
 * TattooDrip's own subscription income from studios (platform admins).
 * Never studio customer money: that stays on each studio's Transactions page.
 */
export default function AdminBilling({
	configured,
	totals,
	studios,
	invoices,
}: Props) {
	return (
		<Page
			title="TattooDrip billing"
			description="Studios' subscriptions to TattooDrip and their invoices. Studio client payments are never included."
			actions={
				<Link
					href={urlFor("admin.payments")}
					className="text-sm underline underline-offset-4"
				>
					Studio payment connections
				</Link>
			}
		>
			{!configured && (
				<p className="rounded-md border border-dashed p-3 text-sm">
					PAYBRIDGE_SECRET_KEY isn't set: billing is off. The records below are
					what was stored before.
				</p>
			)}
			<Section
				title="Subscription income"
				description="Invoices paid to TattooDrip, in NPR. Collected amounts, not settlements."
			>
				<dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
					<Stat label="Paid this month (UTC)" value={totals.paidThisMonth} />
					<Stat label="Paid, all listed invoices" value={totals.paidAllTime} />
					<Stat label="Open or overdue" value={totals.outstanding} />
				</dl>
			</Section>
			<Section title="Studios">
				{studios.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No studio has subscribed yet.
					</p>
				) : (
					<ul className="divide-y">
						{studios.map((studio) => (
							<li
								key={studio.tenantId}
								className="flex flex-wrap justify-between gap-2 py-3 text-sm"
							>
								<span>
									<span className="block font-medium">{studio.name}</span>
									<span className="block text-muted-foreground">
										{studio.planName ?? "No plan"} · {studio.statusText}
									</span>
								</span>
								<span>{studio.accessText}</span>
							</li>
						))}
					</ul>
				)}
			</Section>
			<Section title="Invoices" description="The latest 200.">
				{invoices.length === 0 ? (
					<p className="text-sm text-muted-foreground">No invoices yet.</p>
				) : (
					<ul className="divide-y">
						{invoices.map((invoice) => (
							<li
								key={invoice.id}
								className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
							>
								<span>
									<span className="block font-medium">
										{invoice.studio} · {invoice.number ?? "Invoice"}
									</span>
									<span className="block text-muted-foreground">
										Issued {invoice.issuedText ?? "—"}
										{invoice.paidText && ` · paid ${invoice.paidText}`}
									</span>
								</span>
								<span className="flex items-center gap-2">
									<Badge
										variant={
											invoice.status === "paid"
												? "secondary"
												: invoice.status === "overdue"
													? "destructive"
													: "outline"
										}
									>
										{invoice.statusText}
									</Badge>
									<span className="tabular-nums">{invoice.amount}</span>
								</span>
							</li>
						))}
					</ul>
				)}
			</Section>
		</Page>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-md border p-3">
			<dt className="text-sm text-muted-foreground">{label}</dt>
			<dd className="text-lg tabular-nums">{value}</dd>
		</div>
	);
}

AdminBilling.layout = [AppLayout];
