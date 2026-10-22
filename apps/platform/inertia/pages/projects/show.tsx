import { Form, Link } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { urlFor } from "~/client";
import ChatMessage from "~/components/chat_message";
import DevHostWarning from "~/components/dev_host_warning";
import FinishCard from "~/components/finish_card";
import { SOURCE_LABELS } from "~/components/inquiries";
import MessageCard from "~/components/message_card";
import {
	type ContactChannelName,
	type ContactVia,
	type PrimaryChannel,
	primaryChannel,
} from "~/components/messages";
import Page from "~/components/page";
import PaymentsCard from "~/components/payments_card";
import {
	formatRupees,
	type ManualMoveName,
	MOVE_LABELS,
	type ProjectPageProps,
	type QuoteProps,
	suggestedDeposit,
} from "~/components/projects";
import ReferenceGrid from "~/components/references";
import SessionsCard from "~/components/sessions_card";
import StatusBadge from "~/components/status_badge";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Textarea } from "~/components/ui/textarea";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

type Kind = QuoteProps["kind"];

const KINDS: { value: Kind; title: string; description: string }[] = [
	{
		value: "fixed",
		title: "Fixed price",
		description: "One price for the whole tattoo.",
	},
	{
		value: "hourly",
		title: "Hourly",
		description: "A rate per hour and the hours you expect.",
	},
];

/**
 * One project: its brief, current quote with the chat message and the
 * accept button, the quote form, and earlier versions (TAT-64). TAT-46
 * grows it into the full project screen.
 */
export default function ProjectShow({
	project,
	quote,
	history,
	canQuote,
	canAccept,
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
	bookedWithoutSession,
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
}: ProjectPageProps) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug, id: project.id };
	// A finished step replaces or removes the Finish card with the button
	// that was focused: focus goes to the page heading instead of <body>.
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
			description={
				project.artistName ? `With ${project.artistName}` : "No artist yet"
			}
			actions={
				clientId ? (
					<Link
						route="tenant.clients.show"
						routeParams={{ tenant: tenant.slug, id: clientId }}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						View client
					</Link>
				) : undefined
			}
		>
			<div className="flex max-w-2xl flex-col gap-6">
				{bookedWithoutSession && (
					<output className="block rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
						This project is booked, but no tattoo session is scheduled.
					</output>
				)}

				<Card>
					<CardContent className="flex flex-col gap-3">
						<StatusBadge status={project.status} />
						<p className="text-sm whitespace-pre-line">{project.brief}</p>
						<ContactLine
							text={contactedText}
							onMark={closed ? undefined : () => markContacted()}
						/>
						{moves.length > 0 && (
							<MoveButtons
								projectId={project.id}
								moves={moves}
								scheduledSessionCount={scheduledSessionCount}
								depositHeldText={depositHeldText}
							/>
						)}
						{payments.outcome.needed && (
							<p className="text-sm">
								<a href="#payments" className="underline underline-offset-4">
									Record what happened to the deposit under Payments.
								</a>
							</p>
						)}
						{assignment && (
							<ArtistField projectId={project.id} assignment={assignment} />
						)}
					</CardContent>
				</Card>

				{finish && (
					<FinishCard
						key={finish.step}
						projectId={project.id}
						finish={finish}
						onDone={() => heading.current?.focus()}
					/>
				)}

				<MessageCard
					contact={contact}
					messages={messages}
					initialKind={messageKind}
					lastChannel={lastChannel}
					onContact={markContacted}
				/>

				<SessionsCard
					projectId={project.id}
					sessions={sessions}
					dates={sessionDates}
					scheduling={scheduling}
				/>

				{request && (
					<Card>
						<CardHeader>
							<CardTitle>Request</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
								<dt className="text-muted-foreground">Placement</dt>
								<dd className="min-w-0 break-words">{request.placement}</dd>
								<dt className="text-muted-foreground">Approximate size</dt>
								<dd className="min-w-0 break-words">
									{request.approximateSize}
								</dd>
								<dt className="text-muted-foreground">Preferred dates</dt>
								<dd className="min-w-0 break-words">
									{request.preferredDates}
								</dd>
								<dt className="text-muted-foreground">Budget</dt>
								<dd className="min-w-0 break-words">{request.budget ?? "—"}</dd>
								<dt className="text-muted-foreground">
									Found the studio through
								</dt>
								<dd className="min-w-0 break-words">
									{SOURCE_LABELS[request.source] ?? request.source}
								</dd>
							</dl>
							<ReferenceGrid references={request.references} />
						</CardContent>
					</Card>
				)}

				<Card>
					<CardHeader>
						<CardTitle>Quote</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						{quote ? (
							<QuoteSummary quote={quote} showExpiry={quoteExpiryShown} />
						) : canSetPrice ? (
							<PriceForm projectId={project.id} />
						) : (
							<p className="text-sm text-muted-foreground">No quote yet.</p>
						)}
						{message && (
							<ChatMessage
								message={message}
								primary={primaryChannel(lastChannel)}
								onSent={(channel) => markContacted({ channel, kind: "quote" })}
							/>
						)}
						{canAccept && quote && (
							<AcceptQuote projectId={project.id} quoteId={quote.id} />
						)}
					</CardContent>
				</Card>

				{deposit && (
					<DepositCard
						projectId={project.id}
						deposit={deposit}
						primary={primaryChannel(lastChannel)}
						onSent={(channel) =>
							markContacted({ channel, kind: "deposit_link" })
						}
					/>
				)}

				<PaymentsCard
					projectId={project.id}
					payments={payments}
					canSetPrice={canSetPrice}
				/>

				<Card>
					<CardHeader>
						<CardTitle>Notes</CardTitle>
					</CardHeader>
					<CardContent>
						<NotesForm projectId={project.id} notes={notes} />
					</CardContent>
				</Card>

				{canQuote && (
					<Card>
						<CardHeader>
							<CardTitle>
								{quote ? "Revise the quote" : "Issue a quote"}
							</CardTitle>
						</CardHeader>
						<CardContent>
							<QuoteForm
								key={quote?.id ?? "first"}
								projectId={project.id}
								quote={quote}
								form={form}
							/>
						</CardContent>
					</Card>
				)}

				{history.length > 0 && (
					<Card>
						<CardHeader>
							<CardTitle>Earlier versions</CardTitle>
						</CardHeader>
						<CardContent>
							<ul className="flex flex-col divide-y text-sm">
								{history.map((old) => (
									<li
										key={old.id}
										className="flex flex-wrap justify-between gap-2 py-2"
									>
										<span>
											Version {old.version}: {old.totalText}, deposit{" "}
											{old.depositText}
										</span>
										<span className="text-muted-foreground">
											Issued {old.issuedText}, valid until {old.validUntilText}
										</span>
									</li>
								))}
							</ul>
						</CardContent>
					</Card>
				)}
			</div>
		</Page>
	);
}

function QuoteSummary({
	quote,
	showExpiry,
}: {
	quote: QuoteProps;
	showExpiry: boolean;
}) {
	return (
		<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
			<dt className="text-muted-foreground">Version</dt>
			<dd>{quote.version}</dd>
			<dt className="text-muted-foreground">Price</dt>
			<dd>
				{quote.priceText}
				{quote.kind === "hourly" && ` ≈ ${quote.totalText}`}
			</dd>
			<dt className="text-muted-foreground">Deposit</dt>
			<dd>{quote.depositText}</dd>
			{showExpiry && (
				<>
					<dt className="text-muted-foreground">Valid until</dt>
					<dd className="flex items-center gap-2">
						{quote.validUntilText}
						{quote.expired && <Badge variant="destructive">Expired</Badge>}
					</dd>
				</>
			)}
			<dt className="text-muted-foreground">Issued</dt>
			<dd>{quote.issuedText}</dd>
		</dl>
	);
}

/**
 * The deposit link, for owners while the project waits for its deposit
 * (TAT-65): copy it or send it in a chat, read the reference code, replace
 * a leaked or expired link, and see when a screenshot came.
 */
function DepositCard({
	projectId,
	deposit,
	primary,
	onSent,
}: {
	projectId: string;
	deposit: NonNullable<ProjectPageProps["deposit"]>;
	primary: PrimaryChannel;
	onSent: (channel: ContactChannelName) => void;
}) {
	const tenant = useTenant();
	const [busy, setBusy] = useState(false);
	const { link, problem, message, proofReceivedText, devHost } = deposit;

	const issue = () => {
		if (
			link?.url &&
			!window.confirm(
				"Make a new link? The link you sent before stops working.",
			)
		) {
			return;
		}
		router.post(
			urlFor("tenant.projects.deposit_link.store", {
				tenant: tenant.slug,
				id: projectId,
			}),
			{},
			{
				preserveScroll: true,
				onStart: () => setBusy(true),
				onFinish: () => setBusy(false),
			},
		);
	};
	const copy = (url: string) => {
		navigator.clipboard.writeText(url).then(
			() => toast.success("Link copied."),
			() => toast.error("Couldn't copy: select the link instead."),
		);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Deposit</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{devHost && (
					<DevHostWarning>
						deposit links point at this computer, so a client can't open them.
					</DevHostWarning>
				)}
				{proofReceivedText && (
					<output className="block rounded-md border p-3 text-sm">
						Payment screenshot received {proofReceivedText}:{" "}
						<a href="#payments" className="underline underline-offset-4">
							check it under Payments
						</a>
						.
					</output>
				)}
				{link?.url ? (
					<>
						<Field>
							<FieldLabel htmlFor="deposit-link">Deposit link</FieldLabel>
							<div className="flex gap-2">
								<Input
									id="deposit-link"
									readOnly
									value={link.url}
									onFocus={(event) => event.currentTarget.select()}
									className="min-w-0 flex-1"
								/>
								<Button
									type="button"
									variant="outline"
									onClick={() => copy(link.url ?? "")}
								>
									Copy link
								</Button>
							</div>
							<FieldDescription>
								Works until {link.expiresText}. The client pays with your QR
								codes and sends a screenshot there.
							</FieldDescription>
						</Field>
						<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
							<dt className="text-muted-foreground">Reference code</dt>
							<dd className="font-mono tracking-widest">
								{link.referenceCode}
							</dd>
						</dl>
						{message && (
							<ChatMessage
								message={message}
								primary={primary}
								onSent={onSent}
							/>
						)}
					</>
				) : (
					<p className="text-sm text-muted-foreground">
						{link
							? `The link you sent no longer works. Make a new one: the reference code stays ${link.referenceCode}.`
							: "Make a link where the client pays the deposit with your QR codes and sends a screenshot."}
					</p>
				)}
				{problem ? (
					<p className="text-sm text-muted-foreground">{problem}</p>
				) : (
					<div>
						<Button
							type="button"
							size="sm"
							variant={link?.url ? "outline" : "default"}
							disabled={busy}
							onClick={issue}
						>
							{busy ? "Saving…" : link ? "New link" : "Make deposit link"}
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function AcceptQuote({
	projectId,
	quoteId,
}: {
	projectId: string;
	quoteId: string;
}) {
	const tenant = useTenant();

	return (
		<Form
			route="tenant.projects.quotes.accept"
			routeParams={{ tenant: tenant.slug, id: projectId }}
		>
			{({ processing }) => (
				<div className="flex flex-wrap items-center gap-3">
					<input type="hidden" name="quoteId" value={quoteId} />
					<Button type="submit" disabled={processing}>
						{processing ? "Saving…" : "Client accepted"}
					</Button>
					<p className="text-sm text-muted-foreground">
						Tap when the client agrees. The project then waits for the deposit.
					</p>
				</div>
			)}
		</Form>
	);
}

/**
 * The price of a project booked without one (TAT-66): set once, behind a
 * confirm, because quotes are locked from booked on.
 */
function PriceForm({ projectId }: { projectId: string }) {
	const tenant = useTenant();
	const [price, setPrice] = useState("");

	return (
		<Form
			route="tenant.projects.price.store"
			routeParams={{ tenant: tenant.slug, id: projectId }}
			options={{ preserveScroll: true }}
			onBefore={() =>
				window.confirm(
					`Set the price to ${formatRupees(Number(price))}? It can't be changed afterwards.`,
				)
			}
		>
			{({ errors, processing }) => (
				<FieldGroup>
					<p className="text-sm text-muted-foreground">
						No price was set at booking. Set it once you know it: it can&apos;t
						be changed afterwards.
					</p>
					<Field data-invalid={!!errors.fixedPrice}>
						<FieldLabel htmlFor="finalPrice">Price (NPR)</FieldLabel>
						<Input
							id="finalPrice"
							name="fixedPrice"
							type="number"
							inputMode="numeric"
							min={1}
							step={1}
							value={price}
							onChange={(event) => setPrice(event.target.value)}
							aria-invalid={!!errors.fixedPrice}
							aria-describedby={
								errors.fixedPrice ? "finalPrice-error" : undefined
							}
						/>
						{errors.fixedPrice && (
							<FieldError id="finalPrice-error">{errors.fixedPrice}</FieldError>
						)}
					</Field>
					<div>
						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Saving…" : "Set price"}
						</Button>
					</div>
				</FieldGroup>
			)}
		</Form>
	);
}

/**
 * Issues the first quote or a revision. A revision starts from the current
 * quote; a first quote's deposit follows the studio's default percentage
 * until staff change it.
 */
function QuoteForm({
	projectId,
	quote,
	form,
}: {
	projectId: string;
	quote: QuoteProps | null;
	form: ProjectPageProps["form"];
}) {
	const tenant = useTenant();
	const [kind, setKind] = useState<Kind>(quote?.kind ?? "fixed");
	const [fixedPrice, setFixedPrice] = useState(
		quote?.fixedPrice?.toString() ?? "",
	);
	const [hourlyRate, setHourlyRate] = useState(
		quote?.hourlyRate?.toString() ?? "",
	);
	const [hours, setHours] = useState(quote?.estimatedHours?.toString() ?? "");
	const [depositTouched, setDepositTouched] = useState(quote !== null);
	const [deposit, setDeposit] = useState(quote?.depositAmount.toString() ?? "");

	const total =
		kind === "fixed" ? Number(fixedPrice) : Number(hourlyRate) * Number(hours);
	const shownDeposit = depositTouched
		? deposit
		: String(suggestedDeposit(total, form.depositPercent));

	return (
		<Form
			route="tenant.projects.quotes.store"
			routeParams={{ tenant: tenant.slug, id: projectId }}
		>
			{({ errors, processing }) => (
				<FieldGroup>
					{/* The quote this form was built from: the server refuses the save
					    if someone revised it meanwhile. Empty for a first quote. */}
					<input type="hidden" name="baseQuoteId" value={quote?.id ?? ""} />
					<FieldSet data-invalid={!!errors.kind}>
						<FieldLegend variant="label">Pricing</FieldLegend>
						<RadioGroup
							name="kind"
							value={kind}
							onValueChange={(value) =>
								setKind(value === "hourly" ? "hourly" : "fixed")
							}
						>
							{KINDS.map(({ value, title, description }) => (
								<FieldLabel key={value} htmlFor={`kind-${value}`}>
									<Field orientation="horizontal">
										<FieldContent>
											<FieldTitle>{title}</FieldTitle>
											<FieldDescription>{description}</FieldDescription>
										</FieldContent>
										<RadioGroupItem value={value} id={`kind-${value}`} />
									</Field>
								</FieldLabel>
							))}
						</RadioGroup>
						{errors.kind && <FieldError>{errors.kind}</FieldError>}
					</FieldSet>

					{kind === "fixed" ? (
						<Field data-invalid={!!errors.fixedPrice}>
							<FieldLabel htmlFor="fixedPrice">Price (NPR)</FieldLabel>
							<Input
								id="fixedPrice"
								name="fixedPrice"
								type="number"
								inputMode="numeric"
								min={1}
								step={1}
								value={fixedPrice}
								onChange={(event) => setFixedPrice(event.target.value)}
								aria-invalid={!!errors.fixedPrice}
							/>
							{errors.fixedPrice && (
								<FieldError>{errors.fixedPrice}</FieldError>
							)}
						</Field>
					) : (
						<>
							<Field data-invalid={!!errors.hourlyRate}>
								<FieldLabel htmlFor="hourlyRate">
									Rate per hour (NPR)
								</FieldLabel>
								<Input
									id="hourlyRate"
									name="hourlyRate"
									type="number"
									inputMode="numeric"
									min={1}
									step={1}
									value={hourlyRate}
									onChange={(event) => setHourlyRate(event.target.value)}
									aria-invalid={!!errors.hourlyRate}
								/>
								{errors.hourlyRate && (
									<FieldError>{errors.hourlyRate}</FieldError>
								)}
							</Field>
							<Field data-invalid={!!errors.estimatedHours}>
								<FieldLabel htmlFor="estimatedHours">
									Estimated hours
								</FieldLabel>
								<Input
									id="estimatedHours"
									name="estimatedHours"
									type="number"
									inputMode="decimal"
									min={0.25}
									step={0.25}
									value={hours}
									onChange={(event) => setHours(event.target.value)}
									aria-invalid={!!errors.estimatedHours}
								/>
								<FieldDescription>
									{total > 0
										? `About ${formatRupees(total)} in total.`
										: "In quarter hours: 4.5 for four and a half."}
								</FieldDescription>
								{errors.estimatedHours && (
									<FieldError>{errors.estimatedHours}</FieldError>
								)}
							</Field>
						</>
					)}

					<Field data-invalid={!!errors.depositAmount}>
						<FieldLabel htmlFor="depositAmount">Deposit (NPR)</FieldLabel>
						<Input
							id="depositAmount"
							name="depositAmount"
							type="number"
							inputMode="numeric"
							min={0}
							step={1}
							value={shownDeposit}
							onChange={(event) => {
								setDepositTouched(true);
								setDeposit(event.target.value);
							}}
							aria-invalid={!!errors.depositAmount}
						/>
						<FieldDescription>
							{Number(shownDeposit) === 0
								? "No deposit step: the project is booked once the client accepts and a session is scheduled."
								: !depositTouched && form.depositPercent !== null
									? `Your default ${form.depositPercent}% of the total.`
									: "Paid before the first session."}
						</FieldDescription>
						{errors.depositAmount && (
							<FieldError>{errors.depositAmount}</FieldError>
						)}
					</Field>

					<Field data-invalid={!!errors.expiresOn}>
						<FieldLabel htmlFor="expiresOn">Valid until</FieldLabel>
						<Input
							id="expiresOn"
							name="expiresOn"
							type="date"
							min={form.minDate}
							max={form.maxDate}
							defaultValue={form.defaultValidUntil}
							aria-invalid={!!errors.expiresOn}
						/>
						<FieldDescription>
							If the client hasn&apos;t accepted, or hasn&apos;t paid the
							deposit, by the end of this day, the project is cancelled.
						</FieldDescription>
						{errors.expiresOn && <FieldError>{errors.expiresOn}</FieldError>}
					</Field>

					<div>
						<Button type="submit" disabled={processing}>
							{processing ? "Saving…" : quote ? "Revise quote" : "Issue quote"}
						</Button>
					</div>
				</FieldGroup>
			)}
		</Form>
	);
}

function ContactLine({ text, onMark }: { text: string; onMark?: () => void }) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
			<span className="text-muted-foreground">{text}</span>
			{onMark && (
				<Button type="button" variant="outline" size="sm" onClick={onMark}>
					Mark contacted
				</Button>
			)}
		</div>
	);
}

/** Moves that close a project ask first. */
const CONFIRM: Partial<
	Record<ManualMoveName, (sessions: number, deposit: string | null) => string>
> = {
	decline: (sessions) =>
		sessions > 0
			? `Decline this project? It moves to Closed and cancels ${sessions} scheduled session${sessions === 1 ? "" : "s"}.`
			: "Decline this project? It moves to Closed.",
	withdraw: (sessions, deposit) => {
		const base =
			sessions > 0
				? `Mark that the client withdrew? This cancels the project and ${sessions} scheduled session${sessions === 1 ? "" : "s"}.`
				: "Mark that the client withdrew? This cancels the project.";
		return deposit
			? `${base} The client's deposit of ${deposit} stays recorded: you then record whether the studio keeps it or refunds it.`
			: base;
	},
};

function MoveButtons({
	projectId,
	moves,
	scheduledSessionCount,
	depositHeldText,
}: {
	projectId: string;
	moves: ManualMoveName[];
	scheduledSessionCount: number;
	depositHeldText: string | null;
}) {
	const tenant = useTenant();
	const send = (move: ManualMoveName) => {
		const question = CONFIRM[move]?.(scheduledSessionCount, depositHeldText);
		if (question && !window.confirm(question)) return;
		router.post(
			urlFor("tenant.projects.moves.store", {
				tenant: tenant.slug,
				id: projectId,
			}),
			{ move },
			{ preserveScroll: true },
		);
	};

	return (
		<div className="flex flex-wrap gap-2">
			{moves.map((move) => (
				<Button
					key={move}
					type="button"
					size="sm"
					variant={CONFIRM[move] ? "outline" : "secondary"}
					onClick={() => send(move)}
				>
					{MOVE_LABELS[move]}
				</Button>
			))}
		</div>
	);
}

function ArtistField({
	projectId,
	assignment,
}: {
	projectId: string;
	assignment: NonNullable<ProjectPageProps["assignment"]>;
}) {
	const tenant = useTenant();

	return (
		<Form
			route="tenant.projects.artist.update"
			routeParams={{ tenant: tenant.slug, id: projectId }}
			options={{ preserveScroll: true }}
		>
			{({ errors, processing }) => (
				<Field data-invalid={!!errors.artistId}>
					<FieldLabel htmlFor="artistId">Artist</FieldLabel>
					<div className="flex gap-2">
						<select
							id="artistId"
							name="artistId"
							defaultValue={assignment.artistId ?? ""}
							aria-invalid={!!errors.artistId}
							className="h-9 min-w-0 flex-1 rounded-md border bg-transparent px-3 text-sm max-lg:min-h-11"
						>
							<option value="">No artist</option>
							{assignment.choices.map(({ id, name }) => (
								<option key={id} value={id}>
									{name}
								</option>
							))}
						</select>
						<Button type="submit" size="sm" disabled={processing}>
							Save
						</Button>
					</div>
					{errors.artistId && <FieldError>{errors.artistId}</FieldError>}
				</Field>
			)}
		</Form>
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
