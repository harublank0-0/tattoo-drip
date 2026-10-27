import { router } from "@inertiajs/react";
import type { ReactNode, RefObject } from "react";
import { urlFor } from "~/client";
import ChatMessage from "~/components/chat_message";
import DepositPanel from "~/components/deposit_panel";
import FinishPanel from "~/components/finish_card";
import { FormSheetTrigger, type PageSheets } from "~/components/form_sheet";
import type { ContactVia } from "~/components/messages";
import { primaryChannel } from "~/components/messages";
import { OutcomeForm, PendingProof } from "~/components/payments_card";
import { cardId, layoutOf } from "~/components/project_page";
import type {
	NextStepAction,
	NextStepProps,
	ProjectPageProps,
} from "~/components/projects";
import { AcceptQuote, QuoteForm, ReviseTrigger } from "~/components/quote_card";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { useTenant } from "~/hooks/use-tenant";

type Variant = "default" | "outline";

/**
 * The one thing to do on this project now (TAT-108). The server chose it (`nextStep`, from the
 * same rules as Today and the Projects list) and named its actions; this draws each with the
 * component that already does it: the screenshot to check, the first quote, the quote's message,
 * "Client accepted", the sheets, the deposit link, the finish panel and the deposit's outcome.
 * The card carries the id Today's and the list's links point at (`nextStep.anchor`), so a tap
 * there lands on the action itself. A marigold dot and "Needs you" mark what waits on the studio.
 */
export default function NextStepCard({
	projectId,
	step,
	quote,
	form,
	message,
	deposit,
	payments,
	finish,
	lastChannel,
	onContact,
	sheets,
	fallback,
}: {
	projectId: string;
	step: NextStepProps;
	quote: ProjectPageProps["quote"];
	form: ProjectPageProps["form"];
	message: ProjectPageProps["message"];
	deposit: ProjectPageProps["deposit"];
	payments: ProjectPageProps["payments"];
	finish: ProjectPageProps["finish"];
	lastChannel: ProjectPageProps["lastChannel"];
	onContact: (via: ContactVia) => void;
	/** The page's sheets: this card only draws their triggers. */
	sheets: Pick<PageSheets, "revise" | "record" | "schedule">;
	/** The page's heading: where focus goes when an action removes the button that had it. */
	fallback: RefObject<HTMLElement | null>;
}) {
	const tenant = useTenant();
	const done = () => fallback.current?.focus();
	const { primary, blocks, buttons } = layoutOf(step);

	const draw = (action: string, variant: Variant): ReactNode => {
		switch (action as NextStepAction) {
			case "verify_proof":
				return (
					<div className="flex flex-col gap-4">
						{payments.pending.map((proof) => (
							<PendingProof
								key={proof.paymentId}
								proof={proof}
								onDone={done}
								compact
							/>
						))}
					</div>
				);
			case "issue_quote":
				return (
					<QuoteForm
						key="first"
						projectId={projectId}
						quote={null}
						form={form}
					/>
				);
			case "send_quote":
				return (
					message && (
						<ChatMessage
							message={message}
							primary={primaryChannel(lastChannel)}
							onSent={(channel) => onContact({ channel, kind: "quote" })}
						/>
					)
				);
			case "client_accepted":
				return (
					quote && (
						<AcceptQuote
							projectId={projectId}
							quoteId={quote.id}
							variant={variant}
						/>
					)
				);
			case "revise_quote":
				return (
					quote && (
						<ReviseTrigger
							id={cardId("quote-form", step.anchor)}
							sheet={sheets.revise}
							variant={variant}
						/>
					)
				);
			case "resume":
				return (
					<Button
						type="button"
						variant={variant}
						onClick={() =>
							router.post(
								urlFor("tenant.projects.moves.store", {
									tenant: tenant.slug,
									id: projectId,
								}),
								{ move: "resume" },
								{ preserveScroll: true },
							)
						}
					>
						Resume
					</Button>
				);
			case "deposit_link":
				return (
					deposit && (
						<div
							id={cardId("deposit", step.anchor)}
							className="scroll-mt-[calc(var(--top-bar-height,3.5rem)+0.5rem)] lg:scroll-mt-0"
						>
							<DepositPanel
								projectId={projectId}
								deposit={deposit}
								primary={primaryChannel(lastChannel)}
								onSent={(channel) =>
									onContact({ channel, kind: "deposit_link" })
								}
								fallback={fallback}
							/>
						</div>
					)
				);
			case "record_payment":
				return (
					payments.actions && (
						<FormSheetTrigger
							sheet={sheets.record}
							label="Record payment"
							variant={variant}
						/>
					)
				);
			case "schedule":
				return (
					<FormSheetTrigger
						sheet={sheets.schedule}
						label="Schedule a session"
						variant={variant}
					/>
				);
			case "open_sessions":
				return (
					<a href="#sessions" className={buttonVariants({ variant })}>
						Record it under Sessions
					</a>
				);
			case "finish":
				return (
					finish && (
						<FinishPanel
							key={finish.step}
							projectId={projectId}
							finish={finish}
							onDone={done}
						/>
					)
				);
			case "record_outcome":
				return (
					payments.outcome.needed && (
						<OutcomeForm
							projectId={projectId}
							needed={payments.outcome.needed}
							onDone={done}
							embedded
						/>
					)
				);
			default:
				return null;
		}
	};

	return (
		<Card
			id={step.anchor ?? undefined}
			className="scroll-mt-[calc(var(--top-bar-height,3.5rem)+0.5rem)] max-sm:gap-3 max-sm:py-4 lg:scroll-mt-0"
		>
			<CardHeader className="gap-1">
				<p className="flex items-center gap-2 text-sm text-muted-foreground">
					{step.needsYou && (
						<span
							aria-hidden="true"
							className="size-2 shrink-0 rounded-full bg-marigold"
						/>
					)}
					Next step
				</p>
				<CardTitle className="text-lg leading-snug wrap-anywhere">
					<h2>
						{step.needsYou && <span className="sr-only">Needs you: </span>}
						{step.title}
					</h2>
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{step.text && <p className="text-sm wrap-anywhere">{step.text}</p>}
				{primary && <div>{draw(primary, "default")}</div>}
				{blocks.map((action) => (
					<div key={action}>{draw(action, "outline")}</div>
				))}
				{buttons.length > 0 && (
					<div className="flex flex-wrap gap-2">
						{buttons.map((action) => (
							<div key={action}>{draw(action, "outline")}</div>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
