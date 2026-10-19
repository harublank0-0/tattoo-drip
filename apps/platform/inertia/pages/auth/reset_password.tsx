import { Form, Link } from "@adonisjs/inertia/react";
import { Head } from "@inertiajs/react";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import AuthLayout from "~/layouts/auth";

type Props = { state: "ready" | "expired" | "invalid"; email: string | null };

/**
 * The page a reset link opens (TAT-18). The token stays in the session;
 * this page's URL never holds it. The new password is this form's POST.
 */
export default function ResetPassword({ state, email }: Props) {
	if (state !== "ready" || !email) {
		return <DeadLink expired={state === "expired"} />;
	}

	return (
		<>
			<Head title="Choose a new password" />
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					Choose a new password
				</h1>
				<p className="text-sm text-muted-foreground">
					For{" "}
					<strong className="font-medium break-words text-foreground">
						{email}
					</strong>
					. Every device signed in to this account will be signed out; then sign
					in with the new password.
				</p>
			</div>

			<Form route="password_reset.update">
				{({ errors, processing }) => (
					<FieldGroup>
						{/* Lets a password manager file the new password under this account. */}
						<input
							type="email"
							autoComplete="username"
							value={email}
							readOnly
							hidden
						/>

						<Field data-invalid={!!errors.password}>
							<FieldLabel htmlFor="password">New password</FieldLabel>
							<Input
								id="password"
								name="password"
								type="password"
								autoComplete="new-password"
								className="h-11"
								aria-invalid={!!errors.password}
								aria-describedby="password-rules"
							/>
							<FieldDescription id="password-rules">
								8 to 32 characters.
							</FieldDescription>
							{errors.password && <FieldError>{errors.password}</FieldError>}
						</Field>

						<Field data-invalid={!!errors.passwordConfirmation}>
							<FieldLabel htmlFor="passwordConfirmation">
								Confirm new password
							</FieldLabel>
							<Input
								id="passwordConfirmation"
								name="passwordConfirmation"
								type="password"
								autoComplete="new-password"
								className="h-11"
								aria-invalid={!!errors.passwordConfirmation}
							/>
							{errors.passwordConfirmation && (
								<FieldError>{errors.passwordConfirmation}</FieldError>
							)}
						</Field>

						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Changing…" : "Change password"}
						</Button>
					</FieldGroup>
				)}
			</Form>
		</>
	);
}

function DeadLink({ expired }: { expired: boolean }) {
	const title = expired ? "This link has expired" : "This link no longer works";

	return (
		<>
			<Head title={title} />
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
				<p className="text-sm text-muted-foreground">
					{expired
						? "Reset links work for 1 hour."
						: "It was already used, or a newer link replaced it."}{" "}
					Ask for a new one if you still need it.
				</p>
			</div>
			<Button asChild className="h-11 w-full">
				<Link route="password_reset.create">Ask for a new link</Link>
			</Button>
			<p className="text-center text-sm">
				<Link
					route="session.create"
					className="inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
				>
					Back to sign in
				</Link>
			</p>
		</>
	);
}

ResetPassword.layout = [AuthLayout];
