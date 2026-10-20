import { Form, Link } from "@adonisjs/inertia/react";
import { Head } from "@inertiajs/react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import AuthLayout from "~/layouts/auth";

type Role = "owner" | "artist";
type Step =
	| "sign_in"
	| "switch_account"
	| "confirm_email"
	| "already_member"
	| "accept";

type Props = {
	state: "ready" | "expired" | "invalid";
	studioName: string | null;
	studioSlug: string | null;
	email: string | null;
	role: Role | null;
	profileName: string | null;
	expiresText: string | null;
	flow: string | null;
	step: Step | null;
	viewerEmail: string | null;
};

const ROLE_WORDS: Record<Role, string> = {
	owner: "an owner",
	artist: "an artist",
};

const ROLE_GETS: Record<Role, string> = {
	artist:
		"As an artist you get your own profile, and the projects and sessions assigned to you.",
	owner:
		"As an owner you get everything in the studio, including payments and settings.",
};

function Address({ value }: { value: string }) {
	return (
		<strong className="font-medium break-words text-foreground">{value}</strong>
	);
}

function titleOf({ state, studioName }: Props): string {
	if (state === "expired") return "This invitation has expired";
	if (state === "invalid") return "This invitation no longer works";
	return `Join ${studioName ?? "the studio"}`;
}

function lead(props: Props): ReactNode {
	if (props.state === "expired") {
		return `Invitations work for 7 days. Ask ${props.studioName ?? "the studio"} for a new link.`;
	}
	if (props.state === "invalid" || !props.email || !props.role) {
		return "It was already used or cancelled, or a newer link replaced it. Ask the studio for a new one.";
	}
	return (
		<>
			{props.studioName} invited <Address value={props.email} /> to join as{" "}
			{ROLE_WORDS[props.role]}.
			{props.profileName &&
				` It gives them the artist profile "${props.profileName}", with its projects and sessions.`}
		</>
	);
}

/**
 * The page an invitation link opens (TAT-33). The token stays in the
 * session; this page's URL and props never hold it. Joining is this form's
 * POST, for the invited, confirmed account; the page signs nobody in.
 */
export default function Invitation(props: Props) {
	const title = titleOf(props);
	return (
		<>
			<Head title={title} />
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight break-words">
					{title}
				</h1>
				<p className="text-sm text-muted-foreground">{lead(props)}</p>
			</div>
			{props.state === "ready" && <NextStep {...props} />}
			{props.state === "ready" && props.expiresText && (
				<p className="text-sm text-muted-foreground">
					This invitation works until {props.expiresText}.
				</p>
			)}
		</>
	);
}

function NextStep({
	step,
	email,
	role,
	studioName,
	studioSlug,
	flow,
	viewerEmail,
}: Props) {
	const studio = studioName ?? "the studio";
	if (step === "sign_in" && email) {
		return (
			<div className="flex flex-col gap-3">
				<p className="text-sm text-muted-foreground">
					To accept, sign in as <Address value={email} />, or create an account
					with that address first. Then open this link again.
				</p>
				<Button asChild className="h-11 w-full">
					<Link route="session.create">Sign in</Link>
				</Button>
				<Button asChild variant="outline" className="h-11 w-full">
					<Link route="new_account.create">Create an account</Link>
				</Button>
			</div>
		);
	}
	if (step === "switch_account" && email && viewerEmail) {
		return (
			<div className="flex flex-col gap-3">
				<p className="text-sm text-muted-foreground">
					You're signed in as <Address value={viewerEmail} />. Sign out, sign in
					as <Address value={email} />, then open this link again.
				</p>
				<Form route="session.destroy">
					{({ processing }) => (
						<Button type="submit" className="h-11 w-full" disabled={processing}>
							Sign out
						</Button>
					)}
				</Form>
			</div>
		);
	}
	if (step === "confirm_email" && email) {
		return (
			<div className="flex flex-col gap-3">
				<p className="text-sm text-muted-foreground">
					Confirm <Address value={email} /> first: open the link we emailed you
					when you signed up. Then open this invitation link again.
				</p>
				<Form route="email_verification.resend">
					{({ processing }) => (
						<Button type="submit" className="h-11 w-full" disabled={processing}>
							{processing ? "Sending…" : "Send a new link"}
						</Button>
					)}
				</Form>
			</div>
		);
	}
	if (step === "already_member" && studioSlug) {
		return (
			<div className="flex flex-col gap-3">
				<p className="text-sm text-muted-foreground">
					You're already a member of {studio}.
				</p>
				<Button asChild className="h-11 w-full">
					<Link route="tenant.dashboard" routeParams={{ tenant: studioSlug }}>
						Open {studio}
					</Link>
				</Button>
			</div>
		);
	}
	if (step === "accept" && flow && role) {
		return (
			<div className="flex flex-col gap-3">
				<p className="text-sm text-muted-foreground">{ROLE_GETS[role]}</p>
				<Form route="invitations.accept">
					{({ processing }) => (
						<>
							{/* The invitation this page showed, so the POST can't use another one staged since. */}
							<input type="hidden" name="flow" value={flow} />
							<Button
								type="submit"
								className="h-11 w-full"
								disabled={processing}
							>
								{processing ? "Joining…" : `Join ${studio}`}
							</Button>
						</>
					)}
				</Form>
			</div>
		);
	}
	return null;
}

Invitation.layout = [AuthLayout];
