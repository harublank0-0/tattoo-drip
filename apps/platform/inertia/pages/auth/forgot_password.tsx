import { Form, Link } from "@adonisjs/inertia/react";
import { Head } from "@inertiajs/react";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import AuthLayout from "~/layouts/auth";

/**
 * Asking for a password reset link (TAT-18). The next page says the same
 * whether or not the address has an account.
 */
export default function ForgotPassword() {
	return (
		<>
			<Head title="Reset your password" />
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					Reset your password
				</h1>
				<p className="text-sm text-muted-foreground">
					Enter your account's email address and we'll send you a link to choose
					a new password.
				</p>
			</div>

			<Form route="password_reset.store">
				{({ errors, processing }) => (
					<FieldGroup>
						<Field data-invalid={!!errors.email}>
							<FieldLabel htmlFor="email">Email</FieldLabel>
							<Input
								id="email"
								name="email"
								type="email"
								autoComplete="email"
								placeholder="you@example.com"
								className="h-11"
								aria-invalid={!!errors.email}
							/>
							{errors.email && <FieldError>{errors.email}</FieldError>}
						</Field>

						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Sending…" : "Send the link"}
						</Button>
					</FieldGroup>
				)}
			</Form>

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

ForgotPassword.layout = [AuthLayout];
