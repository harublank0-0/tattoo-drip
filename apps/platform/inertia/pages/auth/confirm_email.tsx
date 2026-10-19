import { Form, Link } from "@adonisjs/inertia/react";
import { Head } from "@inertiajs/react";
import { Button } from "~/components/ui/button";
import AuthLayout from "~/layouts/auth";

/**
 * Where an unconfirmed account goes when it tries to create a tenant
 * (TAT-18, the verifiedEmail gate): its address, "Send a new link", and a
 * way out when the address is wrong.
 */
export default function ConfirmEmail({
	email,
	hasStudio,
}: {
	email: string;
	hasStudio: boolean;
}) {
	return (
		<>
			<Head title="Confirm your email address" />
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					Confirm your email address
				</h1>
				<p className="text-sm text-muted-foreground">
					We sent a link to{" "}
					<strong className="font-medium break-words text-foreground">
						{email}
					</strong>
					. Open it to confirm your address
					{hasStudio ? "." : ", then you can set up your studio."}
				</p>
			</div>

			<p className="text-sm text-muted-foreground">
				The link works for 24 hours. Nothing there? Check your spam folder, or
				send a new link.
			</p>

			<Form route="email_verification.resend">
				{({ processing }) => (
					<Button type="submit" className="h-11 w-full" disabled={processing}>
						{processing ? "Sending…" : "Send a new link"}
					</Button>
				)}
			</Form>

			{hasStudio && (
				<Button asChild variant="outline" className="h-11 w-full">
					<Link route="dashboard">Back to your studio</Link>
				</Button>
			)}

			<div className="flex flex-col gap-2 border-t pt-4">
				<p className="text-sm text-muted-foreground">
					Wrong address? Sign out, then create the account again with the right
					one.
				</p>
				<Form route="session.destroy">
					<Button type="submit" variant="outline" className="h-11 w-full">
						Sign out
					</Button>
				</Form>
			</div>
		</>
	);
}

ConfirmEmail.layout = [AuthLayout];
