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
				<p className="text-sm text-muted-foreground">Sign in to your studio.</p>
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
								className="h-11"
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
								className="h-11"
								aria-invalid={!!errors.password}
							/>
							{errors.password && <FieldError>{errors.password}</FieldError>}
						</Field>

						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "One moment…" : "Sign in"}
						</Button>
					</FieldGroup>
				)}
			</Form>

			<div className="flex flex-col items-center text-sm text-muted-foreground">
				<Link
					route="password_reset.create"
					className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-foreground"
				>
					Forgot your password?
				</Link>
				<p className="flex items-center gap-1">
					New here?
					<Link
						route="new_account.create"
						className="inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
					>
						Create an account
					</Link>
				</p>
			</div>
		</>
	);
}

Login.layout = [AuthLayout];
