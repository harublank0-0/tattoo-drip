import { Link } from "@adonisjs/inertia/react";
import { Head } from "@inertiajs/react";
import AuthLayout from "~/layouts/auth";

/**
 * After a signup or a reset request (TAT-18): the same words whether or not
 * the address has an account, so the page never tells.
 */
export default function CheckEmail({
	purpose,
	email,
}: {
	purpose: "signup" | "reset";
	email: string | null;
}) {
	const address = email ? (
		<strong className="font-medium break-all text-foreground">{email}</strong>
	) : (
		"the address you entered"
	);

	return (
		<>
			<Head title="Check your email" />
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					Check your email
				</h1>
				{purpose === "signup" ? (
					<p className="text-sm text-muted-foreground">
						We sent a link to {address}. Open it to confirm your address, then
						sign in to set up your studio.
					</p>
				) : (
					<p className="text-sm text-muted-foreground">
						If an account uses {address}, we sent it a link to choose a new
						password.
					</p>
				)}
			</div>

			<p className="text-sm text-muted-foreground">
				{purpose === "signup"
					? "The link works for 24 hours. If this address already has an account, the email says how to sign in instead. Nothing there after a few minutes? Check your spam folder."
					: "The link works for 1 hour. Nothing there after a few minutes? Check your spam folder, or ask for a new link."}
			</p>

			<div className="flex flex-col items-center text-sm">
				{purpose === "reset" && (
					<Link
						route="password_reset.create"
						className="inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
					>
						Ask for a new link
					</Link>
				)}
				<Link
					route="session.create"
					className="inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
				>
					Back to sign in
				</Link>
			</div>
		</>
	);
}

CheckEmail.layout = [AuthLayout];
