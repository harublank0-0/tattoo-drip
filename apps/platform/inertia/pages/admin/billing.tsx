import { Link, router } from "@inertiajs/react";
import { useState } from "react";
import { urlFor } from "~/client";
import AdminNav from "~/components/admin_nav";
import Page from "~/components/page";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import AppLayout from "~/layouts/app";

const selectClass =
	"min-h-11 min-w-0 rounded-md border bg-background px-3 text-sm lg:min-h-9";

type Props = {
	configured: boolean;
	totals: { paidThisMonth: string; paidAllTime: string; outstanding: string };
	studios: {
		tenantId: string;
		slug: string;
		name: string;
		planName: string | null;
		statusText: string;
		accessText: string;
		packageText: string;
	}[];
	invoices: {
		id: string;
		tenantId: string;
		studio: string;
		number: string | null;
		status: string;
		statusText: string;
		amount: string;
		paid: string | null;
		issuedText: string | null;
		paidText: string | null;
		grant: "granted" | "ended" | null;
		grantText: string | null;
	}[];
	/** Why staff may end a paid period (a refund PayBridgeNP shows on no invoice). */
	reasons: { value: string; text: string }[];
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
	reasons,
}: Props) {
	return (
		<Page
			title="TattooDrip billing"
			description="Studios' subscriptions to TattooDrip and their invoices. Studio client payments are never included."
			actions={<AdminNav current="billing" />}
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
									<Link
										href={urlFor("admin.studios.show", { slug: studio.slug })}
										className="block font-medium underline-offset-4 hover:underline"
									>
										{studio.name}
									</Link>
									<span className="block text-muted-foreground">
										{studio.planName ?? "No plan"} · {studio.statusText}
									</span>
								</span>
								<span className="text-right">
									<span className="block">{studio.packageText}</span>
									<span className="block text-muted-foreground">
										{studio.accessText}
									</span>
								</span>
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
									{invoice.grantText && (
										<span className="block text-muted-foreground">
											{invoice.grantText}
										</span>
									)}
								</span>
								{invoice.grant === "granted" && (
									<EndAccess
										tenantId={invoice.tenantId}
										invoiceId={invoice.id}
										reasons={reasons}
									/>
								)}
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

/**
 * Ends an invoice's paid period now, for a reason PayBridgeNP doesn't show
 * on the invoice (a refund, a chargeback). It can't be undone, so the reason
 * is chosen, never preset, and the admin confirms. The record stays, marked
 * ended.
 */
function EndAccess({
	tenantId,
	invoiceId,
	reasons,
}: {
	tenantId: string;
	invoiceId: string;
	reasons: Props["reasons"];
}) {
	const [reason, setReason] = useState("");
	const [processing, setProcessing] = useState(false);
	const end = () => {
		if (
			!window.confirm(
				"End this studio's paid access for this invoice now? This can't be undone.",
			)
		) {
			return;
		}
		router.post(
			urlFor("admin.billing.end_access"),
			{ tenantId, invoiceId, reason },
			{
				preserveScroll: true,
				onStart: () => setProcessing(true),
				onFinish: () => setProcessing(false),
			},
		);
	};
	return (
		<span className="flex items-center gap-2">
			<label className="sr-only" htmlFor={`end-reason-${invoiceId}`}>
				Why end access
			</label>
			<select
				id={`end-reason-${invoiceId}`}
				value={reason}
				onChange={(event) => setReason(event.target.value)}
				className={selectClass}
			>
				<option value="" disabled>
					Reason…
				</option>
				{reasons.map((option) => (
					<option key={option.value} value={option.value}>
						{option.text}
					</option>
				))}
			</select>
			<Button
				type="button"
				variant="outline"
				className="h-11 lg:h-9"
				disabled={!reason || processing}
				onClick={end}
			>
				{processing ? "Ending…" : "End access"}
			</Button>
		</span>
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
