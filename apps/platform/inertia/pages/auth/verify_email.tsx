import { Form, Link } from "@adonisjs/inertia/react";
import { Head } from "@inertiajs/react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import AuthLayout from "~/layouts/auth";

type State = "ready" | "done" | "expired" | "invalid";

type Props = {
	state: State;
	email: string | null;
	forSignedInUser: boolean;
	signedInEmail: string | null;
	canResend: boolean;
};

const TITLES: Record<State, string> = {
	ready: "Confirm your email address",
	done: "Email address confirmed",
	expired: "This link has expired",
	invalid: "This link no longer works",
};

function Address({ value }: { value: string }) {
	return (
		<strong className="font-medium break-all text-foreground">{value}</strong>
	);
}

function lead(state: State, email: string | null): ReactNode {
	if (state === "ready" && email) {
		return (
			<>
				Confirm <Address value={email} /> as the email address of your Tattoo
				Drip account.
			</>
		);
	}
	if (state === "done" && email) {
		return (
			<>
				Thanks: <Address value={email} /> is confirmed.
			</>
		);
	}
	if (state === "expired") return "Confirmation links work for 24 hours.";
	return "It was already used, or a newer link replaced it.";
}

/**
 * The page a confirmation link opens (TAT-18). The token stays in the
 * session; this page's URL never holds it. Confirming is this form's POST,
 * and it signs nobody in.
 */
export default function VerifyEmail({
	state,
	email,
	forSignedInUser,
	signedInEmail,
	canResend,
}: Props) {
	return (
		<>
			<Head title={TITLES[state]} />
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					{TITLES[state]}
				</h1>
				<p className="text-sm text-muted-foreground">{lead(state, email)}</p>
			</div>

			{state === "ready" && signedInEmail && !forSignedInUser && (
				<p className="text-sm text-muted-foreground">
					You're signed in as <Address value={signedInEmail} />. Confirming
					changes nothing for that account.
				</p>
			)}

			{state === "ready" ? (
				<Form route="email_verification.confirm">
					{({ processing }) => (
						<Button type="submit" className="h-11 w-full" disabled={processing}>
							{processing ? "Confirming…" : "Confirm email"}
						</Button>
					)}
				</Form>
			) : (
				<NextStep
					done={state === "done"}
					signedIn={Boolean(signedInEmail)}
					canResend={canResend}
				/>
			)}
		</>
	);
}

function NextStep({
	done,
	signedIn,
	canResend,
}: {
	done: boolean;
	signedIn: boolean;
	canResend: boolean;
}) {
	if (canResend) {
		return (
			<Form route="email_verification.resend">
				{({ processing }) => (
					<Button type="submit" className="h-11 w-full" disabled={processing}>
						{processing ? "Sending…" : "Send a new link"}
					</Button>
				)}
			</Form>
		);
	}
	if (signedIn) {
		return (
			<Button asChild className="h-11 w-full">
				<Link route="dashboard">Continue</Link>
			</Button>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			<p className="text-sm text-muted-foreground">
				{done
					? "Sign in to set up your studio."
					: "Sign in to send a new link."}
			</p>
			<Button asChild className="h-11 w-full">
				<Link route="session.create">Sign in</Link>
			</Button>
		</div>
	);
}

VerifyEmail.layout = [AuthLayout];
