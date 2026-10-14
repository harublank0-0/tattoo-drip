import { Form } from "@adonisjs/inertia/react";
import { useState } from "react";
import { toast } from "sonner";
import Page from "~/components/page";
import {
	formatRupees,
	type ProjectPageProps,
	type QuoteProps,
	STATUS_LABELS,
	suggestedDeposit,
} from "~/components/projects";
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
	message,
	form,
}: ProjectPageProps) {
	return (
		<Page
			title={project.clientName ?? "Project"}
			description={
				project.artistName ? `With ${project.artistName}` : "No artist yet"
			}
		>
			<div className="flex max-w-2xl flex-col gap-6">
				<Card>
					<CardContent className="flex flex-col gap-3">
						<Badge variant="secondary">
							{STATUS_LABELS[project.status] ?? project.status}
						</Badge>
						<p className="text-sm whitespace-pre-line">{project.brief}</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Quote</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						{quote ? (
							<QuoteSummary quote={quote} />
						) : (
							<p className="text-sm text-muted-foreground">No quote yet.</p>
						)}
						{message && <ChatMessage message={message} />}
						{canAccept && quote && (
							<AcceptQuote projectId={project.id} quoteId={quote.id} />
						)}
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

function QuoteSummary({ quote }: { quote: QuoteProps }) {
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
			<dt className="text-muted-foreground">Valid until</dt>
			<dd className="flex items-center gap-2">
				{quote.validUntilText}
				{quote.expired && <Badge variant="destructive">Expired</Badge>}
			</dd>
			<dt className="text-muted-foreground">Issued</dt>
			<dd>{quote.issuedText}</dd>
		</dl>
	);
}

/**
 * The quote as a chat message: WhatsApp opens with it filled in; Viber's
 * link can't carry text, so staff copy it and paste.
 */
function ChatMessage({
	message,
}: {
	message: NonNullable<ProjectPageProps["message"]>;
}) {
	const copy = () => {
		navigator.clipboard.writeText(message.text).then(
			() => toast.success("Message copied."),
			() => toast.error("Couldn't copy: select the text instead."),
		);
	};

	return (
		<div className="flex flex-col gap-3 rounded-md border p-3">
			<p className="text-sm whitespace-pre-line">{message.text}</p>
			<div className="flex flex-wrap gap-2">
				<a
					href={message.whatsappUrl}
					target="_blank"
					rel="noreferrer"
					className={buttonVariants({ variant: "outline", size: "sm" })}
				>
					Send on WhatsApp
				</a>
				<a
					href={message.viberUrl}
					className={buttonVariants({ variant: "outline", size: "sm" })}
				>
					Open Viber chat
				</a>
				<Button type="button" variant="ghost" size="sm" onClick={copy}>
					Copy message
				</Button>
			</div>
		</div>
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

ProjectShow.layout = [AppLayout];
