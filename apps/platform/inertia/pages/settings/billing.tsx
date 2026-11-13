import { Form } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { CreditCard } from "lucide-react";
import { useState } from "react";
import { urlFor } from "~/client";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "~/components/ui/empty";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

type Plan = {
	code: string;
	name: string;
	price: string;
	interval: string;
	trialDays: number;
};

type Props = {
	configured: boolean;
	sandbox: boolean;
	access: { state: "paid" | "trial" | "none"; text: string };
	plans: Plan[];
	subscription: {
		status: string;
		statusText: string;
		live: boolean;
		planCode: string | null;
		planName: string | null;
		pendingPlanName: string | null;
		periodText: string | null;
		nextInvoiceText: string | null;
		cancelText: string | null;
		trialText: string | null;
	} | null;
	invoices: {
		id: string;
		number: string | null;
		status: string;
		statusText: string;
		amount: string;
		paid: string | null;
		periodText: string | null;
		dueText: string | null;
		paidText: string | null;
		payable: boolean;
	}[];
};

const selectClass =
	"h-11 w-full rounded-md border bg-background px-3 text-sm sm:w-auto";

/**
 * Settings, Billing (owners): the studio's TattooDrip subscription through
 * PayBridgeNP. Paid access comes from paid invoices only; invoices are paid
 * on PayBridgeNP's own hosted page, never on this one.
 */
export default function Billing({
	configured,
	sandbox,
	access,
	plans,
	subscription,
	invoices,
}: Props) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug };
	const [paying, setPaying] = useState<string | null>(null);
	const [syncing, setSyncing] = useState(false);

	if (!configured) {
		return (
			<Section title="Billing">
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<CreditCard />
						</EmptyMedia>
						<EmptyTitle>Billing isn't set up yet</EmptyTitle>
						<EmptyDescription>
							TattooDrip hasn't turned on subscriptions. Nothing to pay for now.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</Section>
		);
	}

	const live = subscription?.live ? subscription : null;
	const pay = (id: string) => {
		setPaying(id);
		router.post(
			urlFor("tenant.settings.billing.pay", { ...params, id }),
			{},
			{ onFinish: () => setPaying(null) },
		);
	};
	const sync = () => {
		setSyncing(true);
		router.post(
			urlFor("tenant.settings.billing.sync", params),
			{},
			{ preserveScroll: true, onFinish: () => setSyncing(false) },
		);
	};
	const cancel = () => {
		if (
			window.confirm(
				"Cancel at the end of the current period? You keep what you paid for until then.",
			)
		) {
			router.post(
				urlFor("tenant.settings.billing.cancel", params),
				{},
				{ preserveScroll: true },
			);
		}
	};

	return (
		<>
			<Section
				title="Your plan"
				description="What your studio pays TattooDrip. Separate from your clients' payments."
			>
				{sandbox && (
					<p className="mb-3 rounded-md border border-dashed p-3 text-sm">
						Test mode: invoices here are PayBridgeNP sandbox invoices and move
						no real money.
					</p>
				)}
				<div className="flex flex-col gap-3">
					<p className="flex flex-wrap items-center gap-2 text-sm">
						<Badge variant={access.state === "none" ? "outline" : "secondary"}>
							{access.state === "paid"
								? "Paid"
								: access.state === "trial"
									? "Trial"
									: "Not paid"}
						</Badge>
						{access.text}
					</p>
					{subscription ? (
						<dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-sm">
							<dt className="text-muted-foreground">Plan</dt>
							<dd>{subscription.planName ?? "—"}</dd>
							<dt className="text-muted-foreground">Status</dt>
							<dd>{subscription.statusText}</dd>
							{subscription.periodText && (
								<>
									<dt className="text-muted-foreground">Current period</dt>
									<dd>{subscription.periodText}</dd>
								</>
							)}
							{subscription.pendingPlanName && (
								<>
									<dt className="text-muted-foreground">Next plan</dt>
									<dd>{subscription.pendingPlanName}, from the next renewal</dd>
								</>
							)}
						</dl>
					) : (
						<p className="text-sm text-muted-foreground">
							Your studio has no subscription yet.
						</p>
					)}
					{subscription?.trialText && (
						<p className="text-sm">{subscription.trialText}</p>
					)}
					{subscription?.nextInvoiceText && (
						<p className="text-sm text-muted-foreground">
							{subscription.nextInvoiceText}
						</p>
					)}
					{subscription?.cancelText && (
						<p className="text-sm">{subscription.cancelText}</p>
					)}
					<div>
						<Button variant="outline" disabled={syncing} onClick={sync}>
							{syncing ? "Checking…" : "Check for updates"}
						</Button>
					</div>
				</div>
			</Section>

			{!live && plans.length > 0 && (
				<Section
					title="Choose a plan"
					description="PayBridgeNP sends an invoice with a link to pay with eSewa, Khalti or Fonepay. Each renewal is a new invoice you pay the same way; nothing is charged automatically."
				>
					<ul className="flex flex-col gap-3">
						{plans.map((plan) => (
							<li
								key={plan.code}
								className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
							>
								<span>
									<span className="block font-medium">{plan.name}</span>
									<span className="block text-sm text-muted-foreground">
										{plan.price} {plan.interval}
										{plan.trialDays > 0 && `, ${plan.trialDays}-day free trial`}
									</span>
								</span>
								<Form
									route="tenant.settings.billing.subscribe"
									routeParams={params}
								>
									{({ processing }) => (
										<>
											<input type="hidden" name="plan" value={plan.code} />
											<Button
												type="submit"
												className="h-11"
												disabled={processing}
											>
												{processing ? "Starting…" : "Subscribe"}
											</Button>
										</>
									)}
								</Form>
							</li>
						))}
					</ul>
				</Section>
			)}

			{live && !live.cancelText && (
				<Section title="Change or cancel">
					<div className="flex flex-col gap-4">
						{plans.filter((plan) => plan.code !== live.planCode).length > 0 && (
							<Form
								route="tenant.settings.billing.change_plan"
								routeParams={params}
								className="flex flex-wrap items-end gap-2"
							>
								{({ processing }) => (
									<>
										<label className="flex flex-col gap-2 text-sm font-medium">
											Switch at the next renewal to
											<select name="plan" className={selectClass}>
												{plans
													.filter((plan) => plan.code !== live.planCode)
													.map((plan) => (
														<option key={plan.code} value={plan.code}>
															{plan.name} ({plan.price} {plan.interval})
														</option>
													))}
											</select>
										</label>
										<Button
											type="submit"
											variant="outline"
											className="h-11"
											disabled={processing}
										>
											{processing ? "Saving…" : "Schedule change"}
										</Button>
									</>
								)}
							</Form>
						)}
						<div>
							<Button variant="outline" className="h-11" onClick={cancel}>
								Cancel at period end
							</Button>
						</div>
					</div>
				</Section>
			)}

			<Section title="Invoices">
				{invoices.length === 0 ? (
					<p className="text-sm text-muted-foreground">No invoices yet.</p>
				) : (
					<ul className="divide-y">
						{invoices.map((invoice) => (
							<li
								key={invoice.id}
								className="flex flex-wrap items-center justify-between gap-3 py-3"
							>
								<span className="min-w-0">
									<span className="block font-medium">
										{invoice.number ?? "Invoice"} · {invoice.amount}
									</span>
									<span className="block text-sm text-muted-foreground">
										{[
											invoice.periodText,
											invoice.paidText
												? `Paid ${invoice.paidText}`
												: invoice.dueText
													? `Due ${invoice.dueText}`
													: null,
										]
											.filter(Boolean)
											.join(" · ")}
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
									{invoice.payable && (
										<Button
											className="h-11"
											disabled={paying !== null}
											onClick={() => pay(invoice.id)}
										>
											{paying === invoice.id ? "Opening…" : "Pay invoice"}
										</Button>
									)}
								</span>
							</li>
						))}
					</ul>
				)}
			</Section>
		</>
	);
}

Billing.layout = [AppLayout, SettingsLayout];
