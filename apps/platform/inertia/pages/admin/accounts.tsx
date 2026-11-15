import { Form } from "@adonisjs/inertia/react";
import AdminNav from "~/components/admin_nav";
import Page from "~/components/page";
import Section from "~/components/section";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import AppLayout from "~/layouts/app";

/**
 * Confirms an account's address without the link (what `account:verify`
 * does), for a person the operator has checked some other way.
 */
export default function AdminAccounts() {
	return (
		<Page
			title="Accounts"
			description="Confirm an address only after checking who is asking some other way, in person or by phone: this skips the proof the confirmation link gives."
			actions={<AdminNav current="accounts" />}
		>
			<Section title="Confirm an address">
				<Form
					route="admin.accounts.verify"
					errorBag="verify"
					className="flex flex-col gap-2"
				>
					{({ errors, processing }) => (
						<>
							<label htmlFor="account-email" className="sr-only">
								Account email address
							</label>
							<Input
								id="account-email"
								name="email"
								type="email"
								required
								maxLength={254}
								placeholder="owner@example.com"
								className="h-11"
								aria-invalid={!!errors.email}
							/>
							{errors.email && (
								<p className="text-sm text-destructive">{errors.email}</p>
							)}
							<Button type="submit" className="h-11" disabled={processing}>
								{processing ? "Confirming…" : "Confirm address"}
							</Button>
						</>
					)}
				</Form>
			</Section>
		</Page>
	);
}

AdminAccounts.layout = [AppLayout];
