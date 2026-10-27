import { Form, Link } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { cn } from "cn";
import { useRef } from "react";
import { urlFor } from "~/client";
import ChangeCard from "~/components/change_card";
import { DepositCard } from "~/components/deposit_panel";
import { usePageSheets } from "~/components/form_sheet";
import { SOURCE_LABELS } from "~/components/inquiries";
import MessageCard from "~/components/message_card";
import type { ContactVia } from "~/components/messages";
import NextStepCard from "~/components/next_step_card";
import Page from "~/components/page";
import PaymentsCard, {
	RecordPaymentPanel,
	RefundPanel,
} from "~/components/payments_card";
import ProgressLine from "~/components/progress_line";
import { placementsOf } from "~/components/project_page";
import type { ProjectPageProps } from "~/components/projects";
import { PricePanel, QuoteCard, RevisePanel } from "~/components/quote_card";
import ReferenceGrid from "~/components/references";
import SessionsCard, { SchedulePanel } from "~/components/sessions_card";
import StatusBadge from "~/components/status_badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldError } from "~/components/ui/field";
import { Textarea } from "~/components/ui/textarea";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/**
 * One project (TAT-64, TAT-46, TAT-108). The header says who it is for, what the piece is, who
 * tattoos it, its status and how far along it is. Then one Next step card holds the thing to do
 * now, chosen on the server by the rules Today and the Projects list use. Phones read it top to
 * bottom (Next step, sessions, messages, the request, notes, changes, then payments and the
 * quote); from `lg` the money and the quote sit in a second column that stays in view while the
 * first scrolls. Rarely used forms open in a bottom sheet and one-tap actions ask in the page.
 */
export default function ProjectShow(props: ProjectPageProps) {
	const {
		project,
		nextStep,
		quote,
		history,
		canSetPrice,
		payments,
		message,
		contact,
		messages,
		messageKind,
		form,
		moves,
		depositHeldText,
		scheduledSessionCount,
		finish,
		closed,
		quoteExpiryShown,
		sessions,
		sessionDates,
		scheduling,
		notes,
		contactedText,
		lastChannel,
		assignment,
		request,
		clientId,
		deposit,
	} = props;
	const tenant = useTenant();
	// Where each control is drawn: in the Next step card when it names it, else in its own card, so
	// nothing the page offers is out of reach.
	const place = placementsOf(props);
	// One instance of each sheet, whichever card draws its trigger (see usePageSheets).
	const sheets = usePageSheets();
	const params = { tenant: tenant.slug, id: project.id };
	// A save or a finished step can remove the button that had focus: focus goes
	// to the page heading instead of <body>.
	const heading = useRef<HTMLHeadingElement>(null);
	// Every chat link, Call and "Copy message" record the contact in the
	// background (TAT-46), with the channel and the message (TAT-52).
	const markContacted = (via: ContactVia = {}) =>
		router.post(urlFor("tenant.projects.contacted.store", params), via, {
			preserveScroll: true,
			preserveState: true,
		});

	return (
		<Page
			title={project.clientName ?? "Project"}
			titleRef={heading}
			description={project.piece}
			details={
				<div className="flex flex-col gap-2 pt-1">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
						<StatusBadge status={project.status} />
						<span className="text-sm text-muted-foreground">
							{project.artistName
								? `With ${project.artistName}`
								: "No artist yet"}
						</span>
						{clientId && (
							<Link
								route="tenant.clients.show"
								routeParams={{ tenant: tenant.slug, id: clientId }}
								className={cn(
									buttonVariants({ variant: "link", size: "sm" }),
									"-mx-3",
								)}
							>
								View client
							</Link>
						)}
					</div>
					<ProgressLine status={project.status} />
					<p className="text-sm font-medium lg:hidden">{payments.summary}</p>
				</div>
			}
		>
			<div className="grid gap-6 lg:grid-cols-12 lg:items-start">
				<div className="flex min-w-0 flex-col gap-6 lg:col-span-7">
					<NextStepCard
						projectId={project.id}
						step={nextStep}
						quote={quote}
						form={form}
						message={message}
						deposit={deposit}
						payments={payments}
						finish={finish}
						lastChannel={lastChannel}
						onContact={markContacted}
						sheets={sheets}
						fallback={heading}
					/>

					<SessionsCard
						sessions={sessions}
						dates={sessionDates}
						scheduling={scheduling}
						schedule={sheets.schedule}
						anchor={nextStep.anchor}
						showSchedule={place.schedule === "card"}
					/>

					<MessageCard
						contact={contact}
						messages={messages}
						initialKind={messageKind}
						lastChannel={lastChannel}
						onContact={markContacted}
						footer={contactedText}
						onMarkContacted={closed ? undefined : () => markContacted()}
					/>

					<RequestCard
						brief={project.brief}
						request={request}
						fromInquiry={request !== null}
					/>

					<NotesCard projectId={project.id} notes={notes} />

					<ChangeCard
						projectId={project.id}
						moves={moves}
						scheduledSessionCount={scheduledSessionCount}
						depositHeldText={depositHeldText}
						assignment={assignment}
						resumeInNextStep={place.resume === "step"}
						fallback={heading}
					/>
				</div>

				{/* From lg the right column stays in view while the left scrolls, and
				    scrolls inside itself when an opened ledger is taller than the screen. */}
				<div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6 lg:-m-1 lg:col-span-5 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto lg:p-1">
					<PaymentsCard
						projectId={project.id}
						payments={payments}
						canSetPrice={canSetPrice}
						place={place}
						nextStep={nextStep}
						sheets={sheets}
					/>

					{deposit && place.deposit_link === "card" && (
						<DepositCard
							projectId={project.id}
							deposit={deposit}
							lastChannel={lastChannel}
							onContact={markContacted}
							anchor={nextStep.anchor}
							fallback={heading}
						/>
					)}

					<QuoteCard
						projectId={project.id}
						quote={quote}
						history={history}
						form={form}
						showExpiry={quoteExpiryShown}
						message={message}
						lastChannel={lastChannel}
						onContact={markContacted}
						place={place}
						nextStep={nextStep}
						sheets={sheets}
					/>
				</div>
			</div>

			{/* The sheets: one instance each, whichever card draws the trigger. */}
			<RevisePanel
				sheet={sheets.revise}
				projectId={project.id}
				quote={quote}
				form={form}
				available={place.revise_quote !== null}
				fallback={heading}
			/>
			<PricePanel
				sheet={sheets.price}
				projectId={project.id}
				available={place.set_price !== null}
				fallback={heading}
			/>
			<RecordPaymentPanel
				sheet={sheets.record}
				projectId={project.id}
				actions={payments.actions}
				fallback={heading}
			/>
			<RefundPanel
				sheet={sheets.refund}
				projectId={project.id}
				maxText={payments.actions?.refundMaxText ?? null}
				fallback={heading}
			/>
			<SchedulePanel
				sheet={sheets.schedule}
				projectId={project.id}
				scheduling={scheduling}
				dates={sessionDates}
				fallback={heading}
			/>
		</Page>
	);
}

/**
 * What the client asked for: the whole brief and, for a project made from an inquiry, the details
 * and the reference images. A direct booking has only the brief.
 */
function RequestCard({
	brief,
	request,
	fromInquiry,
}: {
	brief: string;
	request: ProjectPageProps["request"];
	fromInquiry: boolean;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="leading-snug">
					<h2>{fromInquiry ? "Request" : "About the piece"}</h2>
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<p className="text-sm whitespace-pre-line wrap-anywhere">{brief}</p>
				{request && (
					<>
						<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
							<dt className="text-muted-foreground">Placement</dt>
							<dd className="min-w-0 wrap-anywhere">{request.placement}</dd>
							<dt className="text-muted-foreground">Approximate size</dt>
							<dd className="min-w-0 wrap-anywhere">
								{request.approximateSize}
							</dd>
							<dt className="text-muted-foreground">Preferred dates</dt>
							<dd className="min-w-0 wrap-anywhere">
								{request.preferredDates}
							</dd>
							<dt className="text-muted-foreground">Budget</dt>
							<dd className="min-w-0 wrap-anywhere">{request.budget ?? "—"}</dd>
							<dt className="text-muted-foreground">
								Found the studio through
							</dt>
							<dd className="min-w-0 wrap-anywhere">
								{SOURCE_LABELS[request.source] ?? request.source}
							</dd>
						</dl>
						<ReferenceGrid references={request.references} />
					</>
				)}
			</CardContent>
		</Card>
	);
}

/** The studio's own notes on the project: internal, and still editable once it is closed. */
function NotesCard({
	projectId,
	notes,
}: {
	projectId: string;
	notes: string | null;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="leading-snug">
					<h2>Notes</h2>
				</CardTitle>
			</CardHeader>
			<CardContent>
				<NotesForm projectId={projectId} notes={notes} />
			</CardContent>
		</Card>
	);
}

function NotesForm({
	projectId,
	notes,
}: {
	projectId: string;
	notes: string | null;
}) {
	const tenant = useTenant();

	return (
		<Form
			route="tenant.projects.notes.update"
			routeParams={{ tenant: tenant.slug, id: projectId }}
			options={{ preserveScroll: true }}
		>
			{({ errors, processing }) => (
				<Field data-invalid={!!errors.notes}>
					<Textarea
						name="notes"
						rows={4}
						maxLength={4000}
						defaultValue={notes ?? ""}
						aria-label="Notes"
						aria-invalid={!!errors.notes}
					/>
					{errors.notes && <FieldError>{errors.notes}</FieldError>}
					<div>
						<Button type="submit" size="sm" disabled={processing}>
							{processing ? "Saving…" : "Save notes"}
						</Button>
					</div>
				</Field>
			)}
		</Form>
	);
}

ProjectShow.layout = [AppLayout];
