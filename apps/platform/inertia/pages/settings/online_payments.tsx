import { Form } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { urlFor } from "~/client";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

type Props = {
	mode: "disabled" | "sandbox" | "live";
	available: boolean;
	account: {
		status: "pending" | "verified" | "suspended";
		livemode: boolean;
		keyHint: string;
		merchantName: string;
		projectName: string;
		connectedText: string;
		verifiedText: string | null;
	} | null;
};

const STATUS_TEXT = {
	pending: "Waiting for TattooDrip's check",
	verified: "Taking payments",
	suspended: "Suspended by TattooDrip",
};

/**
 * Settings, Online payments (owners): the studio's own PayBridgeNP project.
 * Clients' deposits go straight to the studio's own eSewa, Khalti or
 * Fonepay merchant accounts configured there; TattooDrip never holds them.
 */
export default function OnlinePayments({ mode, available, account }: Props) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug };
	const disconnect = () => {
		if (
			window.confirm(
				"Disconnect? Clients can't pay deposits online any more. Payments already started are still recorded.",
			)
		) {
			router.delete(
				urlFor("tenant.settings.online_payments.disconnect", params),
			);
		}
	};

	if (mode === "disabled") {
		return (
			<Section title="Online payments">
				<p className="text-sm text-muted-foreground">
					Online deposits aren't open to studios yet. Clients pay with your
					payment methods and send a screenshot, as now.
				</p>
			</Section>
		);
	}

	return (
		<>
			<Section
				title="Online payments"
				description="Let clients pay their deposit with eSewa, Khalti or Fonepay on the deposit page, through your own PayBridgeNP account."
			>
				<div className="flex flex-col gap-3 text-sm">
					<p>
						The money goes straight to the eSewa, Khalti and Fonepay merchant
						accounts you set up in your PayBridgeNP project. TattooDrip never
						holds it or pays it out, and the deposit is recorded only once
						PayBridgeNP confirms the payment.
					</p>
					{mode === "sandbox" && (
						<p className="rounded-md border border-dashed p-3">
							Test mode: connect a sandbox key (sk_test_). eSewa and Khalti move
							no real money in sandbox; Fonepay does, within PayBridgeNP's caps.
						</p>
					)}
				</div>
			</Section>

			{account && (
				<Section title="Your connection">
					<dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-sm">
						<dt className="text-muted-foreground">Status</dt>
						<dd className="flex flex-wrap items-center gap-2">
							<Badge
								variant={
									account.status === "verified" ? "secondary" : "outline"
								}
							>
								{STATUS_TEXT[account.status]}
							</Badge>
							{available
								? "Clients can pay online."
								: "Clients can't pay online yet."}
						</dd>
						<dt className="text-muted-foreground">Account</dt>
						<dd className="wrap-anywhere">{account.merchantName}</dd>
						<dt className="text-muted-foreground">Project</dt>
						<dd className="wrap-anywhere">{account.projectName}</dd>
						<dt className="text-muted-foreground">Key</dt>
						<dd className="font-mono">
							{account.livemode ? "sk_live_" : "sk_test_"}
							{account.keyHint}
						</dd>
						<dt className="text-muted-foreground">Connected</dt>
						<dd>{account.connectedText}</dd>
						{account.verifiedText && (
							<>
								<dt className="text-muted-foreground">Checked</dt>
								<dd>{account.verifiedText}</dd>
							</>
						)}
					</dl>
					{account.status === "pending" && (
						<p className="mt-3 text-sm text-muted-foreground">
							TattooDrip checks that the project's provider accounts are your
							studio's own before clients can pay. Nothing to do meanwhile.
						</p>
					)}
					<div className="mt-4">
						<Button variant="outline" className="h-11" onClick={disconnect}>
							Disconnect
						</Button>
					</div>
				</Section>
			)}

			<Section
				title={account ? "Replace the key" : "Connect PayBridgeNP"}
				description="In the PayBridgeNP dashboard, open your project, add your eSewa, Khalti or Fonepay merchant details under Providers, then create a secret API key."
			>
				<Form
					route="tenant.settings.online_payments.connect"
					routeParams={params}
					resetOnSuccess
				>
					{({ errors, processing }) => (
						<FieldGroup>
							<Field data-invalid={!!errors.secretKey}>
								<FieldLabel htmlFor="secretKey">Secret API key</FieldLabel>
								<Input
									id="secretKey"
									name="secretKey"
									type="password"
									autoComplete="off"
									spellCheck={false}
									placeholder={mode === "live" ? "sk_live_…" : "sk_test_…"}
									aria-invalid={!!errors.secretKey}
									aria-describedby="secretKey-hint"
									required
								/>
								<FieldDescription id="secretKey-hint">
									Stored encrypted and only used by TattooDrip's server to start
									checkouts and confirm payments. It is never shown again.
								</FieldDescription>
								{errors.secretKey && (
									<FieldError>{errors.secretKey}</FieldError>
								)}
							</Field>
							<Field data-invalid={!!errors.confirmOwnAccount}>
								<label className="flex items-start gap-2 text-sm">
									<input
										type="checkbox"
										name="confirmOwnAccount"
										value="1"
										className="mt-1 size-4"
										required
									/>
									<span>
										The provider accounts in this PayBridgeNP project are my
										studio's own: client payments settle there.
									</span>
								</label>
								{errors.confirmOwnAccount && (
									<FieldError>
										Confirm the accounts are your studio's own.
									</FieldError>
								)}
							</Field>
							<div>
								<Button type="submit" className="h-11" disabled={processing}>
									{processing ? "Checking the key…" : "Connect"}
								</Button>
							</div>
						</FieldGroup>
					)}
				</Form>
			</Section>
		</>
	);
}

OnlinePayments.layout = [AppLayout, SettingsLayout];
