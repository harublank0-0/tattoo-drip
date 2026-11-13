import { Form } from "@adonisjs/inertia/react";
import { Link } from "@inertiajs/react";
import { urlFor } from "~/client";
import Page from "~/components/page";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import AppLayout from "~/layouts/app";

type Props = {
	mode: "disabled" | "sandbox" | "live";
	accounts: {
		tenantId: string;
		accountId: string;
		studio: string;
		status: "pending" | "verified" | "suspended";
		mode: string;
		keyHint: string;
		merchantName: string;
		projectName: string;
		connectedText: string | null;
		verifiedText: string | null;
	}[];
};

/**
 * Platform admins check each studio's PayBridgeNP connection before its
 * clients can pay online: that the project's provider merchant accounts are
 * the studio's own (docs/payments-paybridgenp.md). The API can't show
 * provider credentials, so this check happens outside the software.
 */
export default function AdminPayments({ mode, accounts }: Props) {
	return (
		<Page
			title="Studio payment connections"
			description={`Studio online payments are ${mode}. Verify a connection only after checking, with the studio, that its PayBridgeNP project's eSewa, Khalti and Fonepay accounts are the studio's own.`}
			actions={
				<Link
					href={urlFor("admin.billing")}
					className="text-sm underline underline-offset-4"
				>
					TattooDrip billing
				</Link>
			}
		>
			<Section title="Connections">
				{accounts.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No studio has connected PayBridgeNP.
					</p>
				) : (
					<ul className="divide-y">
						{accounts.map((account) => (
							<li
								key={account.accountId}
								className="flex flex-col gap-2 py-3 text-sm"
							>
								<span className="flex flex-wrap items-center gap-2">
									<span className="font-medium">{account.studio}</span>
									<Badge
										variant={
											account.status === "verified" ? "secondary" : "outline"
										}
									>
										{account.status}
									</Badge>
									<Badge variant="outline">{account.mode}</Badge>
								</span>
								<span className="text-muted-foreground wrap-anywhere">
									PayBridgeNP account {account.merchantName}, project{" "}
									{account.projectName}, key {account.keyHint}. Connected{" "}
									{account.connectedText}
									{account.verifiedText && `, verified ${account.verifiedText}`}
									.
								</span>
								<span className="flex flex-wrap gap-2">
									{account.status !== "verified" && (
										<Review
											account={account}
											decision="verify"
											label="Verify"
										/>
									)}
									{account.status !== "suspended" && (
										<Review
											account={account}
											decision="suspend"
											label="Suspend"
										/>
									)}
								</span>
							</li>
						))}
					</ul>
				)}
			</Section>
		</Page>
	);
}

function Review({
	account,
	decision,
	label,
}: {
	account: Props["accounts"][number];
	decision: "verify" | "suspend";
	label: string;
}) {
	return (
		<Form route="admin.payments.review">
			{({ processing }) => (
				<>
					<input type="hidden" name="tenantId" value={account.tenantId} />
					<input type="hidden" name="accountId" value={account.accountId} />
					<input type="hidden" name="decision" value={decision} />
					<Button
						type="submit"
						className="h-11"
						variant={decision === "verify" ? "default" : "outline"}
						disabled={processing}
					>
						{processing ? "Saving…" : label}
					</Button>
				</>
			)}
		</Form>
	);
}

AdminPayments.layout = [AppLayout];
