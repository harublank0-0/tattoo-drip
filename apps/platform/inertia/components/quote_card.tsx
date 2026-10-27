import { Form } from "@adonisjs/inertia/react";
import { type RefObject, useId, useState } from "react";
import ChatMessage from "~/components/chat_message";
import {
	FormSheetActions,
	FormSheetPanel,
	type FormSheetState,
	FormSheetTrigger,
	type PageSheets,
} from "~/components/form_sheet";
import {
	type ContactChannelName,
	type ContactVia,
	primaryChannel,
} from "~/components/messages";
import {
	type Affordance,
	cardId,
	type Placement,
} from "~/components/project_page";
import {
	formatRupees,
	type NextStepProps,
	type ProjectPageProps,
	priceLabel,
	type QuoteProps,
	suggestedDeposit,
} from "~/components/projects";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
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
import { useTenant } from "~/hooks/use-tenant";

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
 * The Quote card (TAT-108): the current quote and, where the Next step card does not draw them
 * (`place`, from `placementsOf`), the quote's message, "Client accepted", the first quote, "Set
 * price", "Revise the quote", and the earlier versions behind a button. A held project's price
 * message and a quoted project's Accept stay reachable while a screenshot or something else is
 * the next step. The card gives up the `quote` id when the Next step carries it (`cardId`): a link
 * to `#quote` then lands on the card that holds the action.
 */
export function QuoteCard({
	projectId,
	quote,
	history,
	form,
	showExpiry,
	message,
	lastChannel,
	onContact,
	place,
	nextStep,
	sheets,
}: {
	projectId: string;
	quote: QuoteProps | null;
	history: QuoteProps[];
	form: ProjectPageProps["form"];
	showExpiry: boolean;
	message: ProjectPageProps["message"];
	lastChannel: ProjectPageProps["lastChannel"];
	onContact: (via: ContactVia) => void;
	place: Record<Affordance, Placement>;
	nextStep: NextStepProps;
	/** The page's sheets: this card only draws their triggers. */
	sheets: Pick<PageSheets, "revise" | "price">;
}) {
	const listId = useId();
	const [showing, setShowing] = useState(false);

	return (
		<Card
			id={cardId("quote", nextStep.anchor)}
			className="scroll-mt-[calc(var(--top-bar-height,3.5rem)+0.5rem)] lg:scroll-mt-0"
		>
			<CardHeader>
				<CardTitle className="leading-snug">Quote</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{quote ? (
					<QuoteSummary quote={quote} showExpiry={showExpiry} />
				) : (
					<p className="text-sm text-muted-foreground">No quote yet.</p>
				)}
				{place.send_quote === "card" && message && (
					<ChatMessage
						message={message}
						primary={primaryChannel(lastChannel)}
						onSent={(channel: ContactChannelName) =>
							onContact({ channel, kind: "quote" })
						}
					/>
				)}
				{place.client_accepted === "card" && quote && (
					<AcceptQuote projectId={projectId} quoteId={quote.id} />
				)}
				{place.set_price === "card" && (
					<div>
						<FormSheetTrigger sheet={sheets.price} label="Set price" />
					</div>
				)}
				{place.revise_quote === "card" && quote && (
					<ReviseTrigger
						id={cardId("quote-form", nextStep.anchor)}
						sheet={sheets.revise}
					/>
				)}
				{place.issue_quote === "card" && (
					<div
						id={cardId("quote-form", nextStep.anchor)}
						className="scroll-mt-[calc(var(--top-bar-height,3.5rem)+0.5rem)] lg:scroll-mt-0"
					>
						<QuoteForm
							key="first"
							projectId={projectId}
							quote={null}
							form={form}
						/>
					</div>
				)}
				{history.length > 0 && (
					<div className="flex flex-col gap-2">
						<div>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="-ml-3"
								aria-expanded={showing}
								aria-controls={listId}
								onClick={() => setShowing((open) => !open)}
							>
								{showing
									? "Hide earlier versions"
									: `Earlier versions (${history.length})`}
							</Button>
						</div>
						<ul
							id={listId}
							hidden={!showing}
							className="flex flex-col divide-y text-sm"
						>
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
					</div>
				)}
			</CardContent>
		</Card>
	);
}

export function QuoteSummary({
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

/** "Client accepted": the main action of a quoted project, or a secondary one. */
export function AcceptQuote({
	projectId,
	quoteId,
	variant = "default",
}: {
	projectId: string;
	quoteId: string;
	variant?: "default" | "outline";
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
					<Button type="submit" variant={variant} disabled={processing}>
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
 * "Set price" for a project booked without one (TAT-66): a sheet, because the price is set once
 * and quotes are locked from booked on. The button names the price; that is the confirmation. The
 * Quote card draws the trigger; the page mounts this panel once.
 */
export function PricePanel({
	sheet,
	projectId,
	available,
	fallback,
}: {
	sheet: FormSheetState;
	projectId: string;
	available: boolean;
	fallback: RefObject<HTMLElement | null>;
}) {
	return (
		<FormSheetPanel
			sheet={sheet}
			title="Set the price"
			description="No price was set at booking. It can't be changed afterwards."
			fallback={fallback}
			available={available}
		>
			<PriceForm projectId={projectId} sheet={sheet} />
		</FormSheetPanel>
	);
}

function PriceForm({
	projectId,
	sheet,
}: {
	projectId: string;
	sheet: FormSheetState;
}) {
	const tenant = useTenant();
	const [price, setPrice] = useState("");

	return (
		<Form
			route="tenant.projects.price.store"
			routeParams={{ tenant: tenant.slug, id: projectId }}
			options={{ preserveScroll: true }}
			onStart={sheet.onStart}
			onSuccess={sheet.onSuccess}
			onFinish={sheet.onFinish}
			onError={sheet.onError}
		>
			{({ errors, processing }) => (
				<FieldGroup>
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
					<FormSheetActions
						submit={priceLabel(price)}
						processing={processing}
					/>
				</FieldGroup>
			)}
		</Form>
	);
}

/**
 * The "Revise the quote" button, in the Next step card when it names the action and else in the
 * Quote card, inside `id` (`cardId("quote-form", anchor)`) so a link to `#quote-form` lands on it.
 */
export function ReviseTrigger({
	sheet,
	id,
	variant = "outline",
}: {
	sheet: FormSheetState;
	id?: string;
	variant?: "default" | "outline";
}) {
	return (
		<div
			id={id}
			className="scroll-mt-[calc(var(--top-bar-height,3.5rem)+0.5rem)] lg:scroll-mt-0"
		>
			<FormSheetTrigger
				sheet={sheet}
				label="Revise the quote"
				variant={variant}
			/>
		</div>
	);
}

/**
 * "Revise the quote": the quote form in a sheet, mounted once by the page whichever card draws the
 * trigger. The form is keyed by the quote it was built from, so a refused save because someone
 * revised the quote meanwhile remounts it with the new terms while the sheet stays open with the
 * server's message, even when that refusal moves the trigger to another card.
 */
export function RevisePanel({
	sheet,
	projectId,
	quote,
	form,
	available,
	fallback,
}: {
	sheet: FormSheetState;
	projectId: string;
	quote: QuoteProps | null;
	form: ProjectPageProps["form"];
	available: boolean;
	fallback: RefObject<HTMLElement | null>;
}) {
	return (
		<FormSheetPanel
			sheet={sheet}
			title="Revise the quote"
			description="The client gets a new price to accept. Saving sends the project back to Quoted."
			fallback={fallback}
			available={available && quote !== null}
		>
			{quote && (
				<QuoteForm
					key={quote.id}
					projectId={projectId}
					quote={quote}
					form={form}
					sheet={sheet}
				/>
			)}
		</FormSheetPanel>
	);
}

/**
 * Issues the first quote or a revision. A revision starts from the current
 * quote; a first quote's deposit follows the studio's default percentage
 * until staff change it. The first quote sits in the Next step card; a
 * revision opens in a sheet (`sheet`).
 */
export function QuoteForm({
	projectId,
	quote,
	form,
	sheet,
}: {
	projectId: string;
	quote: QuoteProps | null;
	form: ProjectPageProps["form"];
	sheet?: FormSheetState;
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
			options={sheet ? { preserveScroll: true } : undefined}
			onStart={sheet?.onStart}
			onSuccess={sheet?.onSuccess}
			onError={sheet?.onError}
			onFinish={sheet?.onFinish}
		>
			{({ errors, processing }) => (
				<FieldGroup>
					{/* The quote this form was built from: the server refuses the save
					    if someone revised it meanwhile. Empty for a first quote. */}
					<input type="hidden" name="baseQuoteId" value={quote?.id ?? ""} />
					<FieldSet data-invalid={!!errors.kind}>
						<FieldLegend variant="label">Pricing</FieldLegend>
						{/* Side by side: the price field stays on a phone's first screen. */}
						<RadioGroup
							name="kind"
							value={kind}
							className="grid-cols-2 gap-2"
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

					{sheet ? (
						<FormSheetActions submit="Revise quote" processing={processing} />
					) : (
						<div>
							<Button type="submit" disabled={processing}>
								{processing ? "Saving…" : "Issue quote"}
							</Button>
						</div>
					)}
				</FieldGroup>
			)}
		</Form>
	);
}
