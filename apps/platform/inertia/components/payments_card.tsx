import { Form } from "@adonisjs/inertia/react";
import { useEffect, useId, useRef, useState } from "react";
import { urlFor } from "~/client";
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
} from "~/components/payments";
import { formatRupees } from "~/components/projects";
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
 * The project's money (TAT-66): what happened to a closed project's
 * deposit, the balance, the screenshots to check, every payment, and the
 * owners' forms. After every successful submit focus moves to the card's
 * heading, so a screen reader lands on the updated card.
 */
export default function PaymentsCard({
	projectId,
	payments,
	canSetPrice,
}: {
	projectId: string;
	payments: PaymentsCardProps;
	canSetPrice: boolean;
}) {
	const heading = useRef<HTMLHeadingElement>(null);
	const done = () => heading.current?.focus();
	const { balance, deposit, rows, pending, actions, outcome } = payments;

	return (
		<Card id="payments">
			<CardHeader>
				<CardTitle>
					<h2 ref={heading} tabIndex={-1} className="outline-none">
						Payments
					</h2>
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-6">
				{outcome.needed && (
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
				<BalanceBlock
					balance={balance}
					deposit={deposit}
					canSetPrice={canSetPrice}
				/>
				{pending.length > 0 && (
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
				<PaymentList rows={rows} onDone={done} />
				{actions && actions.recordKinds.length > 0 && (
					<RecordPaymentForm
						projectId={projectId}
						actions={actions}
						onDone={done}
					/>
				)}
				{actions?.refundMax != null && actions.refundMaxText && (
					<RefundForm
						projectId={projectId}
						maxText={actions.refundMaxText}
						onDone={done}
					/>
				)}
			</CardContent>
		</Card>
	);
}

function BalanceBlock({
	balance,
	deposit,
	canSetPrice,
}: Pick<PaymentsCardProps, "balance" | "deposit"> & { canSetPrice: boolean }) {
	const line = {
		due: `Balance due ${balance.amountText}`,
		paid: "Paid in full",
		overpaid: `Overpaid by ${balance.amountText}: record a refund if you give it back.`,
		no_price: canSetPrice
			? "No price yet. Set it in the Quote card."
			: "No price yet.",
		closed: `Holds ${balance.amountText}`,
	}[balance.state];
	const total = balance.totalText
		? balance.totalNote
			? `${balance.totalText}, ${balance.totalNote}`
			: balance.totalText
		: "Not set";

	return (
		<div className="flex flex-col gap-2 text-sm">
			<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
				<dt className="text-muted-foreground">Total</dt>
				<dd className="min-w-0 break-words">{total}</dd>
				<dt className="text-muted-foreground">Paid</dt>
				<dd>{balance.paidText}</dd>
			</dl>
			<p className="text-base font-semibold">{line}</p>
			{deposit &&
				(deposit.lapsed ? (
					<p className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
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
	);
}

/**
 * One screenshot to check: the image next to what the deposit page asked
 * for and the reference code (side by side from 640 px, stacked below),
 * then Verify and Reject, each confirmed in an inline panel.
 */
function PendingProof({
	proof,
	onDone,
}: {
	proof: PendingProofProps;
	onDone: () => void;
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
			<div className="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,20rem)_1fr] sm:gap-4">
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
							className="max-h-96 w-full rounded-md border object-contain"
						/>
						<span>Open full size</span>
					</a>
				) : (
					<p className="text-sm text-muted-foreground">No screenshot.</p>
				)}
				<dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-2 text-sm">
					<dt className="text-muted-foreground">Asked to pay</dt>
					<dd className="text-lg font-semibold">{proof.expectedText}</dd>
					<dt className="text-muted-foreground">Reference code</dt>
					<dd className="font-mono text-lg tracking-widest">
						{proof.referenceCode ?? "No deposit link"}
					</dd>
					<dt className="text-muted-foreground">Paid with</dt>
					<dd>{METHOD_LABELS[proof.method]}</dd>
					<dt className="text-muted-foreground">Sent</dt>
					<dd>{proof.sentText}</dd>
				</dl>
			</div>
			{proof.dueNowText && (
				<p className="text-sm">
					The deposit due is now {proof.dueNowText}: the quote changed after
					this was sent.
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

function RecordPaymentForm({
	projectId,
	actions,
	onDone,
}: {
	projectId: string;
	actions: Actions;
	onDone: () => void;
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
			onSuccess={() => {
				setTyped(false);
				onDone();
			}}
		>
			{({ errors, processing }) => (
				<FieldGroup>
					<h3 className="text-sm font-semibold">Record payment</h3>
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
					<div>
						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Saving…" : "Record payment"}
						</Button>
					</div>
				</FieldGroup>
			)}
		</Form>
	);
}

/** "Record a refund": a button that shows the form; the submit asks first. */
function RefundForm({
	projectId,
	maxText,
	onDone,
}: {
	projectId: string;
	maxText: string;
	onDone: () => void;
}) {
	const tenant = useTenant();
	const [open, setOpen] = useState(false);
	const [method, setMethod] = useState<MethodKind>("cash");
	const [amount, setAmount] = useState("");

	if (!open) {
		return (
			<div>
				<Button
					type="button"
					variant="outline"
					className="h-11"
					aria-expanded={false}
					onClick={() => setOpen(true)}
				>
					Record a refund
				</Button>
			</div>
		);
	}
	return (
		<Form
			route="tenant.projects.refunds.store"
			routeParams={{ tenant: tenant.slug, id: projectId }}
			options={{ preserveScroll: true }}
			onBefore={() =>
				window.confirm(
					`Record a refund of ${formatRupees(Number(amount))}? It can't be edited or deleted; a mistake is reversed.`,
				)
			}
			onSuccess={() => {
				setOpen(false);
				setAmount("");
				onDone();
			}}
		>
			{({ errors, processing }) => (
				<FieldGroup>
					<h3 className="text-sm font-semibold">Record a refund</h3>
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
					<div className="flex flex-wrap gap-2">
						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Saving…" : "Record refund"}
						</Button>
						<Button
							type="button"
							variant="ghost"
							className="h-11"
							disabled={processing}
							onClick={() => setOpen(false)}
						>
							Cancel
						</Button>
					</div>
				</FieldGroup>
			)}
		</Form>
	);
}

/** What happened to a closed project's deposit: kept, or refunded (amount, method). */
function OutcomeForm({
	projectId,
	needed,
	onDone,
}: {
	projectId: string;
	needed: NonNullable<PaymentsCardProps["outcome"]["needed"]>;
	onDone: () => void;
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
				<FieldGroup className="rounded-md border p-3">
					<h3 className="text-sm font-semibold">
						What happened to the deposit?
					</h3>
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
