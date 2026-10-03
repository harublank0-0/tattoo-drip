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

export default function Login() {
	return (
		<>
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
				<p className="text-sm text-muted-foreground">
					Sign in to continue building.
				</p>
			</div>

			<Form route="session.store">
				{({ errors, processing }) => (
					<FieldGroup>
						<Field data-invalid={!!errors.email}>
							<FieldLabel htmlFor="email">Email</FieldLabel>
							<Input
								id="email"
								name="email"
								type="email"
								autoComplete="username"
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
								autoComplete="current-password"
								placeholder="••••••••"
								aria-invalid={!!errors.password}
							/>
							{errors.password && <FieldError>{errors.password}</FieldError>}
						</Field>

						<Button type="submit" disabled={processing}>
							{processing ? "One moment…" : "Sign in"}
						</Button>
					</FieldGroup>
				)}
			</Form>

			<p className="text-center text-sm text-muted-foreground">
				New here?{" "}
				<Link
					route="new_account.create"
					className="text-foreground underline underline-offset-4"
				>
					Create an account
				</Link>
			</p>
		</>
	);
}

Login.layout = [AuthLayout];
