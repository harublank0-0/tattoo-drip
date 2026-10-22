import {
	type AnyFieldApi,
	revalidateLogic,
	useStore,
} from "@tanstack/react-form";
import { useSubmitDepositProof } from "@tattoo-drip/react";
import type { DepositState } from "@tattoo-drip/sdk";
import { useEffect, useReducer, useRef, useState } from "react";
import { useAppForm } from "../../components/ui/form.tsx";
import { browserCodec } from "../../intake/browser-codec.ts";
import { Fill } from "../../intake/components/fill.tsx";
import { copy, type DepositMethodKind } from "../copy.ts";
import {
	describeProofError,
	firstMessage,
	focusAfterReread,
	type ProofProblem,
	summaryItems,
	validateProofForm,
} from "../problems.ts";
import { NO_PROOF, prepareProof, previewOf, proofReducer } from "../proof.ts";
import {
	answerCollapsed,
	answerFor,
	type DepositView,
	type MethodPick,
} from "../view-model.ts";
import { ProofNoticeView, ProofSummary } from "./notices.tsx";
import { ProofPicker } from "./proof-picker.tsx";
import { StepHeading } from "./steps.tsx";

/** After this long sending, the status line says a slow connection can take 2 minutes. */
export const SLOW_AFTER_MS = 15_000;

const BROWSER_URLS = {
	create: (file: Blob) => URL.createObjectURL(file),
	revoke: (url: string) => URL.revokeObjectURL(url),
};

type NoticeProblem = Extract<ProofProblem, { kind: "notice" }>;

interface ProofValues {
	method: string;
}

export interface ProofFormProps {
	readonly token: string;
	/** A `due` page that takes a screenshot (`view.takesProof`). */
	readonly view: DepositView;
	readonly studioName: string;
	/**
	 * The client's latest pick in step 2, or null before any: each new pick sets
	 * "How did you pay?", one way (a change in the form itself stays until the
	 * next pick). Nothing else sets it: not a refetch, not a reordered list.
	 */
	readonly pick: MethodPick | null;
	/** Reads the page again: its state now, "gone" (a 404) or "failed". */
	reread(): Promise<DepositState | "gone" | "failed">;
	/** The page left `due` (sent, or changed under the form): the screen moves focus to its message. */
	onLeftDue(): void;
	/** The API answered the send 404: the link is dead, whatever the next read says. */
	onGone(): void;
	/**
	 * A Send starts (true: if the page leaves `due`, focus goes to its message
	 * and the live region stays quiet) or ends with the page still due (false).
	 */
	onSending(active: boolean): void;
}

/**
 * The screenshot form (TAT-65b, spec rulings 15 to 17): how the client paid
 * (TanStack Form), one screenshot prepared by TAT-57's pipeline, and Send,
 * through useSubmitDepositProof (never retried; on 201 the hook puts the
 * `submitted` page in the cache). One attempt at a time; everything picked
 * stays after a refusal.
 */
export function ProofForm({
	token,
	view,
	studioName,
	pick: methodPick,
	reread,
	onLeftDue,
	onGone,
	onSending,
}: ProofFormProps) {
	const submit = useSubmitDepositProof(token);
	const [proof, dispatch] = useReducer(proofReducer, NO_PROOF);
	const [preview, setPreview] = useState<string | null>(null);
	const [proofError, setProofError] = useState<string | null>(null);
	const [notice, setNotice] = useState<NoticeProblem | null>(null);
	const [showSummary, setShowSummary] = useState(false);
	const [focusSummary, setFocusSummary] = useState(false);
	const [sending, setSending] = useState(false);
	const [slow, setSlow] = useState(false);
	const [blockedUntil, setBlockedUntil] = useState<number | null>(null);

	const latestProof = useRef(proof);
	const latestDue = useRef(view.due);
	const blocked = useRef(false);
	const inFlight = useRef(false);
	const mounted = useRef(false);
	const nextId = useRef(0);
	const summaryRef = useRef<HTMLElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const kinds = view.kinds;
	// Change (see "How did you pay?" as one line below): the choices are revealed again.
	const [changing, setChanging] = useState(false);
	const pointerPick = useRef(false);
	const form = useAppForm({
		defaultValues: {
			method:
				kinds.length === 1
					? kinds[0]
					: methodPick && kinds.includes(methodPick.kind)
						? methodPick.kind
						: "",
		} as ProofValues,
		validationLogic: revalidateLogic({
			mode: "submit",
			modeAfterSubmission: "change",
		}),
		validators: {
			onDynamic: ({ value }: { value: ProofValues }) => {
				const fields = validateProofForm(value, kinds);
				return fields ? { fields } : undefined;
			},
		},
		listeners: {
			onChange: ({ fieldApi }) => {
				clearServerError(fieldApi);
				// In the revealed choices, a pointer's pick of another kind ends Change
				// (the line follows). The keyboard's doesn't: its arrows move one choice
				// at a time, and Escape or leaving the choices ends it.
				if (pointerPick.current) {
					pointerPick.current = false;
					setChanging(false);
				}
			},
		},
		onSubmit: ({ value }) => send(value),
		onSubmitInvalid: () => {
			if (latestProof.current.kind === "empty") {
				setProofError(copy.form.required.proof);
			}
			setShowSummary(true);
			setFocusSummary(true);
		},
	});

	// A new pick in step 2 sets the answer, whatever its kind and whatever the
	// client answered by hand since; a re-render with the same pick never does.
	const appliedPick = useRef(methodPick?.count ?? 0);
	useEffect(() => {
		const kind = answerFor(methodPick, appliedPick.current, kinds);
		if (methodPick) appliedPick.current = methodPick.count;
		if (kind) form.setFieldValue("method", kind);
	}, [methodPick, kinds, form]);

	// "How did you pay?" as one line once a pick has answered it (answerCollapsed).
	// The field's value stays in the form while its choices are not on the page,
	// so what is sent is always what the line says.
	const answer = useStore(form.store, (state) => state.values.method);
	const answerErrors = useStore(
		form.store,
		(state) => state.fieldMeta.method?.errors?.length ?? 0,
	);
	const choicesRef = useRef<HTMLDivElement>(null);
	const changeRef = useRef<HTMLButtonElement>(null);
	const focusChoices = useRef(false);
	const wasCollapsed = useRef(false);
	const collapsed = answerCollapsed({
		answer,
		kinds,
		pick: methodPick,
		changing,
		hasError: answerErrors > 0,
	});

	// A new pick in step 2 answers it: Change is over.
	const pickCount = methodPick?.count ?? 0;
	useEffect(() => {
		if (pickCount > 0) setChanging(false);
	}, [pickCount]);

	// Focus follows the swap: Change moves it to the checked choice; when the
	// choices go while it was on one of them (a pick, Escape), to Change.
	useEffect(() => {
		if (focusChoices.current) {
			focusChoices.current = false;
			choicesRef.current
				?.querySelector<HTMLInputElement>('input[name="method"]:checked')
				?.focus();
		} else if (
			collapsed &&
			!wasCollapsed.current &&
			document.activeElement === document.body
		) {
			changeRef.current?.focus();
		}
		wasCollapsed.current = collapsed;
	});

	async function send(values: ProofValues): Promise<void> {
		if (inFlight.current || blocked.current) return;
		const current = latestProof.current;
		if (current.kind !== "ready") {
			if (current.kind === "empty") {
				setProofError(copy.form.required.proof);
				setShowSummary(true);
				setFocusSummary(true);
			}
			return;
		}
		inFlight.current = true;
		onSending(true);
		setNotice(null);
		setShowSummary(false);
		setProofError(null);
		setSending(true);
		try {
			await submit.mutateAsync({
				proof: current.file,
				method: values.method as DepositMethodKind,
				expectedAmount: latestDue.current,
			});
			dispatch({ type: "removed" });
			onLeftDue();
		} catch (error) {
			refused(describeProofError(error));
		} finally {
			inFlight.current = false;
			if (mounted.current) setSending(false);
		}
	}

	function refused(problem: ProofProblem): void {
		if (problem.kind === "fields") {
			const { method, proof: proofMessage } = problem.fields;
			if (method) {
				form.setFieldMeta("method", (meta) => ({
					...meta,
					isTouched: true,
					errorMap: { ...meta.errorMap, onServer: method },
				}));
			}
			if (proofMessage) setProofError(proofMessage);
			setShowSummary(true);
			setFocusSummary(true);
			onSending(false);
			return;
		}
		if (problem.waitSeconds !== null) {
			setBlockedUntil(Date.now() + problem.waitSeconds * 1000);
		}
		setNotice(problem);
		if (problem.refetch) {
			// The page may have moved on (the upload landed after all, the studio
			// acted, the link died): when it left `due`, the screen takes focus to
			// its new message. This form is gone by then; the callback is not.
			void reread().then((next) => {
				if (focusAfterReread(problem.code, next)) onLeftDue();
				else onSending(false);
			});
		} else {
			onSending(false);
		}
		// A 404 on the send is as good as one on a read: the link is dead, and the
		// payment details go even if the read above can't be made.
		if (problem.code === "gone") onGone();
	}

	function pick(file: File): void {
		if (inFlight.current || latestProof.current.kind === "preparing") return;
		const id = nextId.current++;
		setProofError(null);
		dispatch({ type: "picked", id });
		void prepareProof(file, browserCodec).then((result) =>
			dispatch(
				result.ok
					? { type: "prepared", id, file: result.file }
					: { type: "refused", id, problem: result.problem, name: file.name },
			),
		);
	}

	useEffect(() => {
		latestProof.current = proof;
	}, [proof]);

	useEffect(() => {
		latestDue.current = view.due;
	}, [view.due]);

	useEffect(() => {
		blocked.current = blockedUntil !== null;
	}, [blockedUntil]);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	// One preview URL for the prepared screenshot, revoked when it goes.
	const readyFile = proof.kind === "ready" ? proof.file : null;
	useEffect(() => {
		if (!readyFile) {
			setPreview(null);
			return;
		}
		const handle = previewOf(readyFile, BROWSER_URLS);
		setPreview(handle.url);
		return () => handle.release();
	}, [readyFile]);

	useEffect(() => {
		if (!focusSummary) return;
		setFocusSummary(false);
		summaryRef.current?.focus();
	}, [focusSummary]);

	useEffect(() => {
		if (!sending) {
			setSlow(false);
			return;
		}
		const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
		return () => window.clearTimeout(timer);
	}, [sending]);

	// Leaving while the screenshot is on its way asks first.
	useEffect(() => {
		if (!sending) return;
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [sending]);

	useEffect(() => {
		if (blockedUntil === null) return;
		const timer = window.setTimeout(
			() => {
				setBlockedUntil(null);
				setNotice((shown) => (shown?.code === "rate-limited" ? null : shown));
			},
			Math.max(0, blockedUntil - Date.now()),
		);
		return () => window.clearTimeout(timer);
	}, [blockedUntil]);

	const busy = sending || proof.kind === "preparing" || blockedUntil !== null;

	return (
		<section
			className="deposit-block deposit-due-proof"
			aria-labelledby="proof-title"
		>
			<StepHeading step={3} id="proof-title" focusable>
				{copy.form.title}
			</StepHeading>
			{view.lastProofRejected ? (
				<p className="deposit-note">{copy.rejected}</p>
			) : null}
			<form
				className="deposit-form"
				method="post"
				noValidate
				aria-labelledby="proof-title"
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					if (!busy) void form.handleSubmit();
				}}
			>
				<form.Subscribe selector={(state) => state.fieldMeta.method?.errors}>
					{(errors) => {
						const items = summaryItems(firstMessage(errors), proofError);
						return showSummary && items.length > 0 ? (
							<ProofSummary ref={summaryRef} items={items} />
						) : null;
					}}
				</form.Subscribe>
				<div className="deposit-answer" aria-live="polite">
					{collapsed ? (
						<div className="deposit-answer-line">
							<p>
								<Fill
									template={copy.form.paidWith}
									values={{
										label: copy.form.kinds[answer as DepositMethodKind],
									}}
								/>
							</p>
							{kinds.length > 1 ? (
								<>
									<span aria-hidden="true">·</span>
									<button
										ref={changeRef}
										type="button"
										className="deposit-change"
										aria-label={copy.form.changeLabel}
										onClick={() => {
											focusChoices.current = true;
											setChanging(true);
										}}
									>
										{copy.form.change}
									</button>
								</>
							) : null}
						</div>
					) : null}
				</div>
				{collapsed ? null : (
					// biome-ignore lint/a11y/noStaticElementInteractions: only delegates the events of the radios inside, which are the interactive elements
					<div
						ref={choicesRef}
						onClickCapture={(event) => {
							const target = event.target;
							if (
								!changing ||
								event.detail === 0 ||
								!(target instanceof HTMLInputElement) ||
								target.type !== "radio"
							) {
								return;
							}
							// The kind that is already answered fires no change: it is a pick too.
							if (target.value === answer) setChanging(false);
							else pointerPick.current = true;
						}}
						onKeyDown={(event) => {
							if (changing && event.key === "Escape") setChanging(false);
						}}
						onBlur={(event) => {
							if (
								changing &&
								!event.currentTarget.contains(
									event.relatedTarget as Node | null,
								)
							) {
								setChanging(false);
							}
						}}
					>
						<form.AppField name="method">
							{(field) => (
								<field.ChoiceField
									legend={copy.form.method}
									options={kinds.map((kind) => ({
										value: kind,
										label: copy.form.kinds[kind],
									}))}
									required
								/>
							)}
						</form.AppField>
					</div>
				)}
				<ProofPicker
					state={proof}
					preview={preview}
					busy={sending}
					error={proofError}
					inputRef={inputRef}
					onPick={pick}
					onRemove={() => {
						dispatch({ type: "removed" });
						setProofError(null);
						inputRef.current?.focus();
					}}
				/>
				{notice ? (
					<ProofNoticeView
						code={notice.code}
						waitSeconds={notice.waitSeconds}
						studioName={studioName}
					/>
				) : null}
				<div className="deposit-submit">
					<button
						type="submit"
						className="action action-primary"
						aria-disabled={busy ? true : undefined}
					>
						{sending ? copy.form.sending : copy.form.send}
					</button>
					{sending ? (
						<div className="deposit-progress" aria-hidden="true" />
					) : null}
					<p className="deposit-send-status" aria-live="polite">
						{sending
							? slow
								? copy.form.stillSending
								: copy.form.sendingStatus
							: ""}
					</p>
				</div>
			</form>
		</section>
	);
}

/** The API's error on a field goes as soon as the client changes that field. */
function clearServerError(field: AnyFieldApi): void {
	if (field.state.meta.errorMap.onServer === undefined) return;
	field.setMeta((meta) => ({
		...meta,
		errorMap: { ...meta.errorMap, onServer: undefined },
	}));
}
