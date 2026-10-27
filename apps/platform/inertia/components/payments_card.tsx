import { Form } from "@adonisjs/inertia/react";
import { cn } from "cn";
import {
	type ReactNode,
	type RefObject,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { urlFor } from "~/client";
import {
	FormSheetActions,
	FormSheetPanel,
	type FormSheetState,
	FormSheetTrigger,
	type PageSheets,
} from "~/components/form_sheet";
import {
	DESK_KIND_TEXT,
	type DeskKindName,
	KIND_LABELS,
	METHOD_LABELS,
	METHODS,
	type MethodKind,
	PAYMENT_STATUS_LABELS,
	type PaymentRowProps,
	type PaymentsCardProps,
	type PendingProofProps,
	recordFormKey,
} from "~/components/payments";
import {
	type Affordance,
	cardId,
	type Placement,
} from "~/components/project_page";
import { type NextStepProps, refundLabel } from "~/components/projects";
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

type Actions = NonNullable<PaymentsCardProps["actions"]>;

/**
 * The project's money (TAT-66, TAT-108): one line that says where it stands, what happened to a
 * closed project's deposit, the screenshots to check, the payments behind "Show payments" and the
 * owners' sheets for a payment and a refund. What the Next step card already holds (the
 * screenshots, the outcome form, Record payment) is not drawn twice (`placementsOf`), and the card gives
 * up the `payments` id when the Next step carries it (`cardId`). After every successful submit
 * focus moves to the card's heading, so a screen reader lands on the updated card.
 */
export default function PaymentsCard({
	projectId,
	payments,
	canSetPrice,
	place,
	nextStep,
	sheets,
}: {
	projectId: string;
	payments: PaymentsCardProps;
	canSetPrice: boolean;
	/** Where `placementsOf` draws each control: the card draws the ones the Next step does not. */
	place: Record<Affordance, Placement>;
	nextStep: NextStepProps;
	/** The page's sheets: this card only draws their triggers. */
	sheets: Pick<PageSheets, "record" | "refund">;
}) {
	const heading = useRef<HTMLHeadingElement>(null);
	const listId = useId();
	const [showing, setShowing] = useState(false);
	const done = () => heading.current?.focus();
	const { summary, balance, deposit, rows, pending, outcome } = payments;
	const hint =
		balance.state === "overpaid"
			? "Record a refund if you give it back."
			: balance.state === "no_price" && canSetPrice
				? "Set it in the Quote card."
				: balance.totalNote
					? `The total is ${balance.totalNote}.`
					: null;

	return (
		// scroll-mt: an alert opens the page at #payments (TAT-88); on a phone the
		// sticky top bar would cover the card's title, and it grows when a long
		// studio name wraps, so it publishes its height (TopBar).
		<Card
			id={cardId("payments", nextStep.anchor)}
			className="scroll-mt-[calc(var(--top-bar-height,3.5rem)+0.5rem)] lg:scroll-mt-0"
		>
			<CardHeader>
				<CardTitle className="leading-snug">
					<h2 ref={heading} tabIndex={-1} className="outline-none">
						Payments
					</h2>
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="flex flex-col gap-1 text-sm">
					<p className="text-base font-semibold">{summary}</p>
					{hint && <p className="text-muted-foreground">{hint}</p>}
					{deposit &&
						(deposit.lapsed ? (
							<p className="mt-1 rounded-md border border-destructive/50 bg-destructive/10 p-3">
								The deposit is no longer covered: {deposit.dueText} still due.
							</p>
						) : (
							<p className="text-muted-foreground">
								{deposit.covered
									? `Deposit covered (${deposit.amountText})`
									: `Deposit: ${deposit.receivedText} of ${deposit.amountText} received`}
							</p>
						))}
				</div>
				{outcome.needed && place.record_outcome === "card" && (
					<OutcomeForm
						projectId={projectId}
						needed={outcome.needed}
						onDone={done}
					/>
				)}
				{outcome.recorded && (
					<div className="flex flex-col gap-1 text-sm">
						<p>{outcome.recorded.text}</p>
						<p className="text-muted-foreground">
							{outcome.recorded.recordedText}.
						</p>
						{outcome.recorded.note && (
							<p className="whitespace-pre-line text-muted-foreground">
								{outcome.recorded.note}
							</p>
						)}
					</div>
				)}
				{pending.length > 0 && place.verify_proof === "card" && (
					<section
						aria-labelledby="proofs-heading"
						className="flex flex-col gap-4"
					>
						<h3 id="proofs-heading" className="text-sm font-semibold">
							Screenshots to check
						</h3>
						{pending.map((proof) => (
							<PendingProof key={proof.paymentId} proof={proof} onDone={done} />
						))}
					</section>
				)}
				{rows.length === 0 ? (
					<p className="text-sm text-muted-foreground">No payments yet.</p>
				) : (
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
								{showing ? "Hide payments" : `Show payments (${rows.length})`}
							</Button>
						</div>
						<div id={listId} hidden={!showing}>
							<PaymentList rows={rows} onDone={done} />
						</div>
					</div>
				)}
				<div className="flex flex-wrap gap-2">
					{place.record_payment === "card" && (
						<FormSheetTrigger sheet={sheets.record} label="Record payment" />
					)}
					{place.record_refund === "card" && (
						<FormSheetTrigger sheet={sheets.refund} label="Record a refund" />
					)}
				</div>
			</CardContent>
		</Card>
	);
}

/**
 * One screenshot to check: the image next to what the deposit page asked
 * for and the reference code (side by side from 640 px, stacked below),
 * then Verify and Reject, each confirmed in an inline panel.
 */
export function PendingProof({
	proof,
	onDone,
	compact = false,
}: {
	proof: PendingProofProps;
	onDone: () => void;
	/** In the Next step card the image is shorter, so Verify and Reject are on a phone's first screen. */
	compact?: boolean;
}) {
	const tenant = useTenant();
	const [open, setOpen] = useState<"verify" | "reject" | null>(null);
	const verifyButton = useRef<HTMLButtonElement>(null);
	const rejectButton = useRef<HTMLButtonElement>(null);
	const params = { tenant: tenant.slug, id: proof.paymentId };
	const close = () => {
		const back = open === "reject" ? rejectButton : verifyButton;
		setOpen(null);
		back.current?.focus();
	};

	return (
		<div className="flex flex-col gap-3 rounded-md border p-3">
			<div
				className={cn(
					compact
						? "grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4"
						: "flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,20rem)_1fr] sm:gap-4",
				)}
			>
				{proof.imageUrl ? (
					<a
						href={proof.imageUrl}
						target="_blank"
						rel="noreferrer"
						className="flex flex-col gap-1 text-sm underline-offset-4 hover:underline"
					>
						<img
							src={proof.imageUrl}
							alt={`Payment screenshot sent ${proof.sentText}`}
							width={proof.width ?? undefined}
							height={proof.height ?? undefined}
							className={cn(
								"w-full rounded-md border object-contain",
								compact ? "max-h-40 sm:max-h-48" : "max-h-96",
							)}
						/>
						<span>Open full size</span>
					</a>
				) : (
					<p className="text-sm text-muted-foreground">No screenshot.</p>
				)}
				<dl
					className={cn(
						"content-start text-sm",
						compact
							? "flex min-w-0 flex-col gap-2 sm:grid sm:grid-cols-[auto_1fr] sm:gap-x-4"
							: "grid grid-cols-[auto_1fr] gap-x-4 gap-y-2",
					)}
				>
					<Fact compact={compact} label="Asked to pay">
						<dd className="text-lg font-semibold">{proof.expectedText}</dd>
					</Fact>
					<Fact compact={compact} label="Reference code">
						<dd className="font-mono text-lg tracking-widest wrap-anywhere">
							{proof.referenceCode ?? "No deposit link"}
						</dd>
					</Fact>
					{compact && (
						// One line on a phone, so Verify and Reject stay on the first screen.
						<div className="sm:hidden">
							<dt className="sr-only">Paid with and sent</dt>
							<dd className="text-muted-foreground">
								{METHOD_LABELS[proof.method]} · {proof.sentText}
							</dd>
						</div>
					)}
					<Fact compact={compact} fromSm label="Paid with">
						<dd>{METHOD_LABELS[proof.method]}</dd>
					</Fact>
					<Fact compact={compact} fromSm label="Sent">
						<dd>{proof.sentText}</dd>
					</Fact>
				</dl>
			</div>
			{proof.dueNowText && (
				<p className="text-sm">
					The deposit due is now {proof.dueNowText}: the quote or the payments
					received changed after this was sent.
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button
					ref={verifyButton}
					type="button"
					className="h-11"
					aria-expanded={open === "verify"}
					onClick={() => setOpen("verify")}
				>
					Verify
				</Button>
				<Button
					ref={rejectButton}
					type="button"
					variant="outline"
					className="h-11"
					aria-expanded={open === "reject"}
					onClick={() => setOpen("reject")}
				>
					Reject
				</Button>
			</div>
			{open === "verify" && (
				<ConfirmPanel
					action={urlFor("tenant.payments.verify", params)}
					question={`Verify ${proof.expectedText}? Do it only if it reached your account${proof.referenceCode ? ` with code ${proof.referenceCode}` : ""}.`}
					noteLabel="Note (optional, only your team sees it)"
					submitLabel="Verify payment"
					onCancel={close}
					onDone={() => {
						setOpen(null);
						onDone();
					}}
				/>
			)}
			{open === "reject" && (
				<ConfirmPanel
					action={urlFor("tenant.payments.reject", params)}
					question="Reject this screenshot? The client is asked for a new one on the deposit page."
					noteLabel="Reason (optional, only your team sees it)"
					submitLabel="Reject screenshot"
					onCancel={close}
					onDone={() => {
						setOpen(null);
						onDone();
					}}
				/>
			)}
		</div>
	);
}

/**
 * One fact of a screenshot: its label over its value on a phone in the Next step card (the
 * image sits beside the facts there), side by side everywhere else.
 */
function Fact({
	compact,
	label,
	fromSm = false,
	children,
}: {
	compact: boolean;
	label: string;
	/** Only from `sm`: a phone's compact card says it in one line instead. */
	fromSm?: boolean;
	children: ReactNode;
}) {
	return (
		<div
			className={cn(
				compact ? "flex min-w-0 flex-col sm:contents" : "contents",
				compact && fromSm && "max-sm:hidden",
			)}
		>
			<dt className="text-muted-foreground">{label}</dt>
			{children}
		</div>
	);
}

/**
 * An inline confirmation: the question, an optional note (focused when the
 * panel opens), the confirm button and Cancel. Escape cancels.
 */
function ConfirmPanel({
	action,
	question,
	noteLabel,
	submitLabel,
	onCancel,
	onDone,
}: {
	action: string;
	question: string;
	noteLabel: string;
	submitLabel: string;
	onCancel: () => void;
	onDone: () => void;
}) {
	const id = useId();
	const note = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		note.current?.focus();
	}, []);

	return (
		<Form
			action={action}
			method="post"
			options={{ preserveScroll: true }}
			onSuccess={onDone}
		>
			{({ errors, processing }) => (
				<fieldset
					aria-labelledby={`${id}-question`}
					className="flex min-w-0 flex-col gap-3 rounded-md bg-muted/50 p-3"
					onKeyDown={(event) => {
						if (event.key === "Escape") onCancel();
					}}
				>
					<p id={`${id}-question`} className="text-sm">
						{question}
					</p>
					<Field data-invalid={!!errors.note}>
						<FieldLabel htmlFor={`${id}-note`}>{noteLabel}</FieldLabel>
						<Textarea
							ref={note}
							id={`${id}-note`}
							name="note"
							rows={2}
							maxLength={500}
							aria-invalid={!!errors.note}
							aria-describedby={errors.note ? `${id}-note-error` : undefined}
						/>
						{errors.note && (
							<FieldError id={`${id}-note-error`}>{errors.note}</FieldError>
						)}
					</Field>
					<div className="flex flex-wrap gap-2">
						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Saving…" : submitLabel}
						</Button>
						<Button
							type="button"
							variant="ghost"
							className="h-11"
							disabled={processing}
							onClick={onCancel}
						>
							Cancel
						</Button>
					</div>
				</fieldset>
			)}
		</Form>
	);
}

function PaymentList({
	rows,
	onDone,
}: {
	rows: PaymentRowProps[];
	onDone: () => void;
}) {
	if (rows.length === 0) {
		return <p className="text-sm text-muted-foreground">No payments yet.</p>;
	}
	return (
		<ul className="flex flex-col divide-y text-sm">
			{rows.map((row) => (
				<PaymentItem key={row.id} row={row} onDone={onDone} />
			))}
		</ul>
	);
}

function PaymentItem({
	row,
	onDone,
}: {
	row: PaymentRowProps;
	onDone: () => void;
}) {
	const tenant = useTenant();
	const [reversing, setReversing] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const unsigned = row.amountText.replace(/^−/, "");

	return (
		<li className="flex flex-col gap-1 py-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="font-medium">
					{KIND_LABELS[row.kind]} {row.amountText}
				</span>
				<Badge variant={row.status === "verified" ? "secondary" : "outline"}>
					{PAYMENT_STATUS_LABELS[row.status]}
				</Badge>
			</div>
			<span className="text-muted-foreground">
				{METHOD_LABELS[row.method]} · {row.dateText}
			</span>
			<span className="text-muted-foreground">{row.decisionText}</span>
			{row.reversalText && <span>{row.reversalText}</span>}
			{row.note && <span className="whitespace-pre-line">{row.note}</span>}
			{(row.proofUrl || row.canReverse) && (
				<div className="flex flex-wrap gap-2 pt-1">
					{row.proofUrl && (
						<a
							href={row.proofUrl}
							target="_blank"
							rel="noreferrer"
							className={buttonVariants({
								variant: "outline",
								className: "h-11",
							})}
						>
							View screenshot
						</a>
					)}
					{row.canReverse && (
						<Button
							ref={trigger}
							type="button"
							variant="ghost"
							className="h-11"
							aria-expanded={reversing}
							onClick={() => setReversing(true)}
						>
							Reverse
						</Button>
					)}
				</div>
			)}
			{reversing && (
				<ConfirmPanel
					action={urlFor("tenant.payments.reverse", {
						tenant: tenant.slug,
						id: row.id,
					})}
					question={`Reverse this ${unsigned} ${KIND_LABELS[row.kind].toLowerCase()}? Use it when the money never arrived or the entry was a mistake. The reversal is recorded; nothing is deleted.`}
					noteLabel="Reason (optional)"
					submitLabel="Reverse payment"
					onCancel={() => {
						setReversing(false);
						trigger.current?.focus();
					}}
					onDone={() => {
						setReversing(false);
						onDone();
					}}
				/>
			)}
		</li>
	);
}

/** The amount to prefill for a kind, in rupees, or empty. */
function prefill(actions: Actions, kind: DeskKindName): string {
	const value =
		kind === "deposit"
			? actions.depositDue
			: kind === "balance"
				? actions.balanceDue
				: null;
	return value === null ? "" : String(value);
}

/**
 * "Record payment": the desk form in a sheet, mounted once by the page whichever card draws the
 * trigger (the Next step card, or the Payments card).
 */
export function RecordPaymentPanel({
	sheet,
	projectId,
	actions,
	fallback,
}: {
	sheet: FormSheetState;
	projectId: string;
	actions: Actions | null;
	fallback: RefObject<HTMLElement | null>;
}) {
	return (
		<FormSheetPanel
			sheet={sheet}
			title="Record payment"
			description="Money the client paid at the desk or by transfer. It is recorded as verified."
			fallback={fallback}
			available={actions !== null && actions.recordKinds.length > 0}
		>
			{actions && (
				<RecordPaymentForm
					key={recordFormKey(actions)}
					projectId={projectId}
					actions={actions}
					sheet={sheet}
				/>
			)}
		</FormSheetPanel>
	);
}

function RecordPaymentForm({
	projectId,
	actions,
	sheet,
}: {
	projectId: string;
	actions: Actions;
	sheet: FormSheetState;
}) {
	const tenant = useTenant();
	const first = actions.recordKinds[0];
	const [kind, setKind] = useState<DeskKindName>(first);
	const [method, setMethod] = useState<MethodKind>("cash");
	const [amount, setAmount] = useState(prefill(actions, first));
	const [typed, setTyped] = useState(false);
	const choose = (value: string) => {
		const next = actions.recordKinds.find((known) => known === value) ?? first;
		setKind(next);
		if (!typed) setAmount(prefill(actions, next));
	};

	return (
		<Form
			route="tenant.projects.payments.store"
			routeParams={{ tenant: tenant.slug, id: projectId }}
			options={{ preserveScroll: true }}
			onStart={sheet.onStart}
			onSuccess={sheet.onSuccess}
			onError={sheet.onError}
			onFinish={sheet.onFinish}
		>
			{({ errors, processing }) => (
				<FieldGroup>
					<FieldSet data-invalid={!!errors.kind}>
						<FieldLegend variant="label">What was paid</FieldLegend>
						<RadioGroup name="kind" value={kind} onValueChange={choose}>
							{actions.recordKinds.map((value) => (
								<FieldLabel key={value} htmlFor={`record-kind-${value}`}>
									<Field orientation="horizontal" className="min-h-11">
										<FieldContent>
											<FieldTitle>{DESK_KIND_TEXT[value].title}</FieldTitle>
											{DESK_KIND_TEXT[value].description && (
												<FieldDescription>
													{DESK_KIND_TEXT[value].description}
												</FieldDescription>
											)}
										</FieldContent>
										<RadioGroupItem value={value} id={`record-kind-${value}`} />
									</Field>
								</FieldLabel>
							))}
						</RadioGroup>
						{errors.kind && <FieldError>{errors.kind}</FieldError>}
					</FieldSet>
					<MethodField
						idPrefix="record"
						value={method}
						onChange={setMethod}
						error={errors.method}
					/>
					<AmountField
						id="record-amount"
						value={amount}
						onChange={(value) => {
							setTyped(true);
							setAmount(value);
						}}
						error={errors.amount}
						hint={null}
					/>
					<NoteField id="record-note" error={errors.note} />
					<FormSheetActions submit="Record payment" processing={processing} />
				</FieldGroup>
			)}
		</Form>
	);
}

/**
 * "Record a refund": the form in a sheet. The submit button names the amount, which is the
 * confirmation (it replaces the browser's confirm); the sheet's description says it is final.
 */
export function RefundPanel({
	sheet,
	projectId,
	maxText,
	fallback,
}: {
	sheet: FormSheetState;
	projectId: string;
	maxText: string | null;
	fallback: RefObject<HTMLElement | null>;
}) {
	return (
		<FormSheetPanel
			sheet={sheet}
			title="Record a refund"
			description="A refund can't be edited or deleted; a mistake is reversed."
			fallback={fallback}
			available={maxText !== null}
		>
			{maxText && (
				<RefundForm projectId={projectId} maxText={maxText} sheet={sheet} />
			)}
		</FormSheetPanel>
	);
}

function RefundForm({
	projectId,
	maxText,
	sheet,
}: {
	projectId: string;
	maxText: string;
	sheet: FormSheetState;
}) {
	const tenant = useTenant();
	const [method, setMethod] = useState<MethodKind>("cash");
	const [amount, setAmount] = useState("");

	return (
		<Form
			route="tenant.projects.refunds.store"
			routeParams={{ tenant: tenant.slug, id: projectId }}
			options={{ preserveScroll: true }}
			onStart={sheet.onStart}
			onSuccess={sheet.onSuccess}
			onError={sheet.onError}
			onFinish={sheet.onFinish}
		>
			{({ errors, processing }) => (
				<FieldGroup>
					<AmountField
						id="refund-amount"
						value={amount}
						onChange={setAmount}
						error={errors.amount}
						hint={`At most ${maxText}.`}
					/>
					<MethodField
						idPrefix="refund"
						value={method}
						onChange={setMethod}
						error={errors.method}
					/>
					<NoteField id="refund-note" error={errors.note} />
					<FormSheetActions
						submit={refundLabel(amount)}
						processing={processing}
					/>
				</FieldGroup>
			)}
		</Form>
	);
}

/** What happened to a closed project's deposit: kept, or refunded (amount, method). */
export function OutcomeForm({
	projectId,
	needed,
	onDone,
	embedded = false,
}: {
	projectId: string;
	needed: NonNullable<PaymentsCardProps["outcome"]["needed"]>;
	onDone: () => void;
	/** In the Next step card, whose title already asks the question: no box and no heading of its own. */
	embedded?: boolean;
}) {
	const tenant = useTenant();
	const [outcome, setOutcome] = useState<"kept" | "refunded">("kept");
	const [amount, setAmount] = useState(String(needed.held));
	const [method, setMethod] = useState<MethodKind>("cash");

	return (
		<Form
			route="tenant.projects.deposit_outcome.store"
			routeParams={{ tenant: tenant.slug, id: projectId }}
			options={{ preserveScroll: true }}
			onSuccess={onDone}
		>
			{({ errors, processing }) => (
				<FieldGroup className={cn(!embedded && "rounded-md border p-3")}>
					{!embedded && (
						<h3 className="text-sm font-semibold">
							What happened to the deposit?
						</h3>
					)}
					<p className="text-sm">
						This project closed holding a deposit of {needed.heldText}. Record
						what the studio decided; your deposit policy is yours.
					</p>
					<FieldSet data-invalid={!!errors.outcome}>
						<FieldLegend variant="label">Outcome</FieldLegend>
						<RadioGroup
							name="outcome"
							value={outcome}
							onValueChange={(value) =>
								setOutcome(value === "refunded" ? "refunded" : "kept")
							}
						>
							{(
								[
									["kept", "The studio keeps it"],
									["refunded", "Refund it"],
								] as const
							).map(([value, title]) => (
								<FieldLabel key={value} htmlFor={`outcome-${value}`}>
									<Field orientation="horizontal" className="min-h-11">
										<FieldContent>
											<FieldTitle>{title}</FieldTitle>
										</FieldContent>
										<RadioGroupItem value={value} id={`outcome-${value}`} />
									</Field>
								</FieldLabel>
							))}
						</RadioGroup>
						{errors.outcome && <FieldError>{errors.outcome}</FieldError>}
					</FieldSet>
					{outcome === "refunded" && (
						<>
							<AmountField
								id="outcome-amount"
								value={amount}
								onChange={setAmount}
								error={errors.amount}
								hint={`At most ${needed.heldText}; the rest is kept.`}
							/>
							<MethodField
								idPrefix="outcome"
								value={method}
								onChange={setMethod}
								error={errors.method}
							/>
						</>
					)}
					<NoteField id="outcome-note" error={errors.note} />
					<div>
						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Saving…" : "Record outcome"}
						</Button>
					</div>
				</FieldGroup>
			)}
		</Form>
	);
}

function MethodField({
	idPrefix,
	value,
	onChange,
	error,
}: {
	idPrefix: string;
	value: MethodKind;
	onChange: (method: MethodKind) => void;
	error: string | undefined;
}) {
	return (
		<FieldSet data-invalid={!!error}>
			<FieldLegend variant="label">Method</FieldLegend>
			<RadioGroup
				name="method"
				value={value}
				onValueChange={(next) =>
					onChange(METHODS.find((known) => known === next) ?? "cash")
				}
				className="grid grid-cols-2 gap-2 sm:grid-cols-3"
			>
				{METHODS.map((method) => (
					<FieldLabel key={method} htmlFor={`${idPrefix}-method-${method}`}>
						<Field orientation="horizontal" className="min-h-11">
							<FieldContent>
								<FieldTitle>{METHOD_LABELS[method]}</FieldTitle>
							</FieldContent>
							<RadioGroupItem
								value={method}
								id={`${idPrefix}-method-${method}`}
							/>
						</Field>
					</FieldLabel>
				))}
			</RadioGroup>
			{error && <FieldError>{error}</FieldError>}
		</FieldSet>
	);
}

function AmountField({
	id,
	value,
	onChange,
	error,
	hint,
}: {
	id: string;
	value: string;
	onChange: (value: string) => void;
	error: string | undefined;
	hint: string | null;
}) {
	const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
		.filter(Boolean)
		.join(" ");
	return (
		<Field data-invalid={!!error}>
			<FieldLabel htmlFor={id}>Amount (NPR)</FieldLabel>
			<Input
				id={id}
				name="amount"
				type="number"
				inputMode="decimal"
				min={0.01}
				step={0.01}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				aria-invalid={!!error}
				aria-describedby={described || undefined}
				className="h-11"
			/>
			{hint && <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>}
			{error && <FieldError id={`${id}-error`}>{error}</FieldError>}
		</Field>
	);
}

function NoteField({ id, error }: { id: string; error: string | undefined }) {
	return (
		<Field data-invalid={!!error}>
			<FieldLabel htmlFor={id}>Note (optional)</FieldLabel>
			<Textarea
				id={id}
				name="note"
				rows={2}
				maxLength={500}
				aria-invalid={!!error}
				aria-describedby={error ? `${id}-error` : undefined}
			/>
			{error && <FieldError id={`${id}-error`}>{error}</FieldError>}
		</Field>
	);
}
