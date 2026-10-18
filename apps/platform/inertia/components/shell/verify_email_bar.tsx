import { Form } from "@adonisjs/inertia/react";
import { usePage } from "@inertiajs/react";
import { Button } from "~/components/ui/button";

/**
 * Under the top bar while the signed-in account's address isn't confirmed
 * (TAT-18). Nothing on a studio page is blocked; it only asks, with "Send a
 * new link".
 */
export default function VerifyEmailBar() {
	const { user } = usePage().props;
	if (!user || user.emailVerified) return null;

	return (
		<section
			aria-label="Email confirmation"
			className="flex flex-wrap items-center justify-center gap-x-3 border-b bg-muted px-4 text-sm"
		>
			<p className="py-2">
				Confirm your email address: we sent a link to{" "}
				<strong className="font-medium break-all">{user.email}</strong>.
			</p>
			<Form route="email_verification.resend">
				{({ processing }) => (
					<Button
						type="submit"
						variant="link"
						className="h-11 px-0"
						disabled={processing}
					>
						{processing ? "Sending…" : "Send a new link"}
					</Button>
				)}
			</Form>
		</section>
	);
}
