import { Form, Link } from "@adonisjs/inertia/react";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import AuthLayout from "~/layouts/auth";

export default function Signup() {
	return (
		<>
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					Create your account
				</h1>
				<p className="text-sm text-muted-foreground">
					Start building with the starter kit.
				</p>
			</div>

			<Form route="new_account.store">
				{({ errors, processing }) => (
					<FieldGroup>
						<Field data-invalid={!!errors.fullName}>
							<FieldLabel htmlFor="fullName">Full name</FieldLabel>
							<Input
								id="fullName"
								name="fullName"
								type="text"
								autoComplete="name"
								placeholder="Ada Lovelace"
								aria-invalid={!!errors.fullName}
							/>
							{errors.fullName && <FieldError>{errors.fullName}</FieldError>}
						</Field>

						<Field data-invalid={!!errors.email}>
							<FieldLabel htmlFor="email">Email</FieldLabel>
							<Input
								id="email"
								name="email"
								type="email"
								autoComplete="email"
								placeholder="you@example.com"
								aria-invalid={!!errors.email}
							/>
							{errors.email && <FieldError>{errors.email}</FieldError>}
						</Field>

						<Field data-invalid={!!errors.password}>
							<FieldLabel htmlFor="password">Password</FieldLabel>
							<Input
								id="password"
								name="password"
								type="password"
								autoComplete="new-password"
								placeholder="••••••••"
								aria-invalid={!!errors.password}
							/>
							{errors.password && <FieldError>{errors.password}</FieldError>}
						</Field>

						<Field data-invalid={!!errors.passwordConfirmation}>
							<FieldLabel htmlFor="passwordConfirmation">
								Confirm password
							</FieldLabel>
							<Input
								id="passwordConfirmation"
								name="passwordConfirmation"
								type="password"
								autoComplete="new-password"
								placeholder="••••••••"
								aria-invalid={!!errors.passwordConfirmation}
							/>
							{errors.passwordConfirmation && (
								<FieldError>{errors.passwordConfirmation}</FieldError>
							)}
						</Field>

						<Button type="submit" disabled={processing}>
							{processing ? "One moment…" : "Create account"}
						</Button>
					</FieldGroup>
				)}
			</Form>

			<p className="text-center text-sm text-muted-foreground">
				Already have an account?{" "}
				<Link
					route="session.create"
					className="text-foreground underline underline-offset-4"
				>
					Sign in
				</Link>
			</p>
		</>
	);
}

Signup.layout = [AuthLayout];
