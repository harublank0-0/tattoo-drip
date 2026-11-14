import { useStartDepositCheckout } from "@tattoo-drip/react";
import { TattooApiError } from "@tattoo-drip/sdk";
import { useState } from "react";
import { Fill } from "../../intake/components/fill.tsx";
import { fill } from "../../intake/template.ts";
import { copy } from "../copy.ts";
import type { DepositView } from "../view-model.ts";

/*
 * "Pay online" (docs/payments-paybridgenp.md): the API starts a checkout on
 * the studio's own payment provider for the deposit still due (the page
 * sends no amount) and answers with the provider's page, which this opens in
 * the same tab. Coming back proves nothing: the API records the payment
 * only once the provider confirms it, and the page then reads `paid`.
 */

type Problem = "unavailable" | "inProgress" | "busy" | "failed";

function problemOf(error: unknown): Problem {
	if (error instanceof TattooApiError) {
		if (error.code === "online_payment_unavailable") return "unavailable";
		if (error.code === "online_payment_in_progress") return "inProgress";
		if (
			error.code === "payment_provider_unavailable" ||
			error.code === "service_busy" ||
			error.code === "rate_limited"
		) {
			return "busy";
		}
	}
	return "failed";
}

export function OnlinePay({
	token,
	view,
	studioName,
}: {
	token: string;
	view: DepositView;
	studioName: string;
}) {
	const start = useStartDepositCheckout(token);
	const [leaving, setLeaving] = useState(false);
	const problem = start.error ? problemOf(start.error) : null;
	const busy = start.isPending || leaving;
	const pay = () => {
		if (busy) return;
		start.mutate(undefined, {
			onSuccess: ({ checkoutUrl }) => {
				// Only ever an https page: never a script or another scheme.
				if (!checkoutUrl.startsWith("https://")) return;
				setLeaving(true);
				window.location.assign(checkoutUrl);
			},
		});
	};
	return (
		<section
			className="deposit-block deposit-online"
			aria-labelledby="deposit-online-title"
		>
			<h2 id="deposit-online-title">{copy.online.title}</h2>
			<p>
				<Fill template={copy.online.body} values={{ studio: studioName }} />
			</p>
			{view.online.checkout === "confirming" ? (
				<p className="deposit-muted">{copy.online.confirming}</p>
			) : null}
			{view.online.checkout === "failed" ||
			view.online.checkout === "expired" ? (
				<p className="deposit-muted">{copy.online.retry}</p>
			) : null}
			<button
				type="button"
				className="action action-primary"
				aria-disabled={busy ? true : undefined}
				onClick={pay}
			>
				{busy
					? copy.online.opening
					: fill(copy.online.button, { amount: view.dueText })}
			</button>
			<p className="deposit-send-status" aria-live="polite">
				{problem ? copy.online[problem] : ""}
			</p>
			<p className="deposit-muted">{copy.online.or}</p>
		</section>
	);
}

/** Back from the provider's page (`?online=` and no token): what happens next. */
export function OnlineReturned({ studioName }: { studioName: string }) {
	return (
		<section className="deposit-block" aria-labelledby="deposit-returned-title">
			<h2 id="deposit-returned-title">{copy.online.returnedTitle}</h2>
			<p>
				<Fill template={copy.online.returned} values={{ studio: studioName }} />
			</p>
		</section>
	);
}
