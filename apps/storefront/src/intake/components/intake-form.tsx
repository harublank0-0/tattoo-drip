import { type AnyFieldApi, revalidateLogic } from "@tanstack/react-form";
import { useCreateInquiry } from "@tattoo-drip/react";
import {
	type CreateInquiryInput,
	INQUIRY_HONEYPOT_FIELD,
	type InquiryReceipt,
} from "@tattoo-drip/sdk";
import { useEffect, useReducer, useRef, useState } from "react";
import {
	BOOKING_LIMITS,
	BOOKING_WORDS,
	type BookingContext,
	type BookingField,
	type BookingStep,
	type BookingValues,
	bookingFieldOf,
	bookingSteps,
	bookingValues,
	COLOURS,
	intakeValuesOf,
	SIZES,
	STEP_FIELDS,
	sizeText,
	styleName,
	TIMES_OF_DAY,
} from "../../booking/booking.ts";
import {
	BookingReview,
	BookingSent,
	BookingSummary,
	type RequestSnapshot,
} from "../../booking/components/booking-review.tsx";
import {
	ArtistChoice,
	BookingProgress,
	PreferredDates,
} from "../../booking/components/booking-steps.tsx";
import { bookingCopy } from "../../booking/copy.ts";
import { useAppForm } from "../../components/ui/form.tsx";
import { zonedNow } from "../../studio/hours.ts";
import type { InquiryChannels, InquiryState } from "../../studio/inquiry.ts";
import { browserCodec } from "../browser-codec.ts";
import { Challenge, TURNSTILE_PRIVACY_URL } from "../challenge.ts";
import { browserChallengeHost } from "../challenge-host.ts";
import { copy } from "../copy.ts";
import { prepareReference } from "../images.ts";
import {
	afterBlockEnds,
	describeChallengeFailure,
	describeSubmitError,
	unexpectedProblem,
} from "../problems.ts";
import {
	canAdd,
	EMPTY_REFERENCES,
	hasPhotoErrors,
	isPreparing,
	lostPhotos,
	nextToPrepare,
	type ReferencesState,
	readyItems,
	referencesReducer,
	syncPreviews,
	totalBytes,
} from "../references.ts";
import {
	type DetailField,
	FIELD_ORDER,
	INTAKE_LIMITS,
	type IntakeField,
	initialValues,
	SOURCE_CHANNELS,
	validateIntake,
} from "../rules.ts";
import { toInquiryInput } from "../submission.ts";
import { createSubmitter } from "../submit-flow.ts";
import { Fill } from "./fill.tsx";
import { LeaveGuard } from "./leave-guard.tsx";
import {
	ChatLinks,
	ErrorSummary,
	type FormPhase,
	hasChannels,
	type NoticeProblem,
	ProblemNotice,
	SubmitStatus,
	type SummaryItem,
} from "./notices.tsx";
import { ReferencePicker } from "./reference-picker.tsx";

export interface IntakeFormProps {
	/** TAT-48's open state: the studio, the artist asked for, the artists who take inquiries. */
	readonly state: Extract<InquiryState, { kind: "open" }>;
	/** The studio's chat links, for "Prefer to chat?" and refusals the form can't fix. */
	readonly channels: InquiryChannels;
	/** The public Turnstile site key, or null in development (no check, no token). */
	readonly challengeSiteKey: string | null;
	/** What the booking flow knows of the studio, its artists and the piece asked about (Prompt 6). */
	readonly booking: BookingContext;
}

/** After this long sending, the status line says a slow connection can take 2 minutes. */
export const SLOW_AFTER_MS = 15_000;
/** Radio fields: a summary link focuses their first radio. */
const CHOICE_FIELDS = new Set<IntakeField>([
	"preferredArtistId",
	"sourceChannel",
]);
const BROWSER_URLS = {
	create: (file: File) => URL.createObjectURL(file),
	revoke: (url: string) => URL.revokeObjectURL(url),
};

/**
 * The intake form (TAT-57): TAT-51's inquiry, sent from the browser with
 * useCreateInquiry(), photos shrunk first (images.ts), a Turnstile token per
 * attempt (challenge.ts) and TAT-55's honeypot. Mounted by IntakeMount only
 * after hydration. Every outcome but success keeps what the person entered.
 */
export function IntakeForm({
	state,
	channels,
	challengeSiteKey,
	booking,
}: IntakeFormProps) {
	const { studioName, preferredArtist, artists } = state;
	// A flash request is for the design's artist alone: no picker (TAT-129).
	const flashDesignId = state.flashDesignId ?? null;
	const showArtists =
		flashDesignId === null && (artists.length >= 2 || preferredArtist !== null);
	const createInquiry = useCreateInquiry();
	// Prompt 6's steps. The cards are the artists the intake may name, with
	// what the page knows of them; "today" is the studio's, not the device's.
	const rules = booking.calendar;
	const [today] = useState(
		() =>
			zonedNow(new Date(), rules.timeZone)?.date ??
			new Date().toISOString().slice(0, 10),
	);
	const steps = bookingSteps(showArtists);
	const [step, setStep] = useState<BookingStep>(steps[0]);
	const [reached, setReached] = useState(0);
	const [summaryFields, setSummaryFields] = useState<readonly BookingField[]>(
		[],
	);
	const checked = useRef(false);
	const stepTitle = useRef<HTMLHeadingElement>(null);
	const cards = booking.artists.filter((artist) =>
		artists.some((open) => open.id === artist.id),
	);
	const errorsOf = (values: BookingValues) =>
		bookingErrors(values, today, booking, {
			studioName,
			artistIds: artists.map((artist) => artist.id),
		});
	// The steps reached so far, for the form's validator (it is created once):
	// a later step's fields are not judged before the client gets there.
	const shownUpTo = useRef(0);
	shownUpTo.current = steps.indexOf(step);
	const judged = (errors: ReturnType<typeof errorsOf>) => {
		const fields = new Set(
			steps
				.slice(0, shownUpTo.current + 1)
				.flatMap((each) => STEP_FIELDS[each]),
		);
		return Object.fromEntries(
			Object.entries(errors).filter(([field]) =>
				fields.has(field as BookingField),
			),
		);
	};

	const [references, dispatch] = useReducer(
		referencesReducer,
		EMPTY_REFERENCES,
	);
	const [previews, setPreviews] = useState<ReadonlyMap<string, string>>(
		() => new Map(),
	);
	const [phase, setPhase] = useState<FormPhase>("idle");
	const [slow, setSlow] = useState(false);
	const [notice, setNotice] = useState<NoticeProblem | null>(null);
	const [showSummary, setShowSummary] = useState(false);
	/** A photo was refused while Send waited, so nothing was sent. */
	const [photosStopped, setPhotosStopped] = useState(false);
	const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
	const [sentTo, setSentTo] = useState<string | null>(null);
	const [focus, setFocus] = useState<
		"summary" | "notice" | "sent" | "step" | null
	>(null);
	const [sent, setSent] = useState<{
		artistName: string | null;
		dates: string;
		reference: string;
	} | null>(null);

	const honeypot = useRef<HTMLInputElement>(null);
	const challengeBox = useRef<HTMLDivElement>(null);
	const summaryRef = useRef<HTMLElement>(null);
	const noticeRef = useRef<HTMLElement>(null);
	const sentRef = useRef<HTMLHeadingElement>(null);
	const latest = useRef<ReferencesState>(EMPTY_REFERENCES);
	const previewUrls = useRef<ReadonlyMap<string, string>>(new Map());
	const photoWaiters = useRef<Array<() => void>>([]);
	const inFlight = useRef(false);
	const nextPhotoId = useRef(0);
	const sendRef = useRef<
		(input: CreateInquiryInput) => Promise<InquiryReceipt>
	>(createInquiry.mutateAsync);

	const [challenge] = useState(() =>
		challengeSiteKey
			? new Challenge(challengeSiteKey, browserChallengeHost(), (interactive) =>
					setPhase((current) =>
						current === "checking" || current === "interactive"
							? interactive
								? "interactive"
								: "checking"
							: current,
					),
				)
			: null,
	);
	const [submit] = useState(() =>
		createSubmitter({
			challenge,
			send: (input) => sendRef.current(input),
			onPhase: setPhase,
		}),
	);

	const form = useAppForm({
		defaultValues: bookingValues(
			initialValues(preferredArtist?.id ?? null, state.start ?? null),
		),
		validationLogic: revalidateLogic({
			mode: "submit",
			modeAfterSubmission: "change",
		}),
		validators: {
			onDynamic: ({ value }: { value: BookingValues }) => {
				const fields = judged(errorsOf(value));
				return Object.keys(fields).length > 0 ? { fields } : undefined;
			},
		},
		listeners: {
			onChange: ({ fieldApi }) => {
				clearServerError(fieldApi);
				// A refusal shown on a field the flow composes goes when any of its parts changes.
				const composed = COMPOSED_FROM[fieldApi.name as BookingInput];
				if (composed) {
					form.setFieldMeta(composed, (meta) =>
						meta.errorMap.onServer === undefined
							? meta
							: {
									...meta,
									errorMap: { ...meta.errorMap, onServer: undefined },
								},
					);
				}
				// Once a step was checked, its messages follow what is typed.
				if (checked.current) void form.validate("submit");
			},
		},
		onSubmit: ({ value }) => send(value),
		// Something on an earlier step is wrong (the review step's Send checks
		// them all): go to the first such step and say what.
		onSubmitInvalid: ({ value }) => showErrorsOn(firstStepWithErrors(value)),
	});

	/** The first step, in order, with a field that is wrong; the current one when none is. */
	function firstStepWithErrors(values: BookingValues): BookingStep {
		const errors = errorsOf(values);
		return (
			steps.find((each) =>
				STEP_FIELDS[each].some((field) => hasProblem(field, errors)),
			) ?? step
		);
	}

	/** Whether a field is wrong: by the flow's rules, or refused by the API and not changed since. */
	function hasProblem(
		field: BookingField,
		errors: ReturnType<typeof errorsOf>,
	): boolean {
		return (
			errors[field] !== undefined ||
			form.state.fieldMeta[field]?.errorMap?.onServer !== undefined
		);
	}

	/** Shows `target`'s problems: its fields marked touched, the summary of them, the keyboard on it. */
	function showErrorsOn(target: BookingStep) {
		checked.current = true;
		for (const field of STEP_FIELDS[target]) {
			form.setFieldMeta(field, (meta) => ({ ...meta, isTouched: true }));
		}
		void form.validate("submit");
		setStep(target);
		setSummaryFields(STEP_FIELDS[target]);
		setShowSummary(true);
		setFocus("summary");
	}

	/** Continue: the step's fields checked, then the next step, its heading focused. */
	function goNext() {
		const errors = errorsOf(form.state.values);
		const problem = STEP_FIELDS[step].some((field) =>
			hasProblem(field, errors),
		);
		const photoProblem = step === "tattoo" && hasPhotoErrors(latest.current);
		if (problem || photoProblem) {
			showErrorsOn(step);
			return;
		}
		goTo(steps[Math.min(steps.indexOf(step) + 1, steps.length - 1)]);
	}

	function goTo(target: BookingStep) {
		const index = steps.indexOf(target);
		setReached((furthest) => Math.max(furthest, index));
		setStep(target);
		setShowSummary(false);
		setFocus("step");
	}

	/** What the review and the summary show: the values and what they become. */
	function snapshotOf(values: BookingValues): RequestSnapshot {
		const intake = intakeValuesOf(values, today, rules);
		return {
			values,
			artistName:
				cards.find((artist) => artist.id === values.preferredArtistId)?.name ??
				artists.find((artist) => artist.id === values.preferredArtistId)
					?.name ??
				null,
			dates: intake.preferredDates,
			styleName: styleName(booking.styles, values.style),
			photoCount: readyItems(references).length,
			artwork: booking.artwork,
		};
	}

	async function send(values: BookingValues): Promise<void> {
		if (inFlight.current) return;
		if (blockedUntil !== null && Date.now() < blockedUntil) return;
		inFlight.current = true;
		try {
			setNotice(null);
			setShowSummary(false);
			setPhotosStopped(false);
			if (hasPhotoErrors(latest.current)) {
				setStep("tattoo");
				setSummaryFields(STEP_FIELDS.tattoo);
				setShowSummary(true);
				setFocus("summary");
				return;
			}
			if (isPreparing(latest.current)) {
				const asked = latest.current;
				setPhase("preparing");
				await new Promise<void>((done) => photoWaiters.current.push(done));
				// A photo refused meanwhile is not sent without a word: stop, say so,
				// and keep its message (in the tray) in view. The person can't remove
				// photos while Send waits, so a photo that vanished was refused.
				if (lostPhotos(asked, latest.current).length > 0) {
					setPhotosStopped(true);
					setStep("tattoo");
					setSummaryFields(STEP_FIELDS.tattoo);
					setShowSummary(true);
					setFocus("summary");
					return;
				}
			}
			const photos = readyItems(latest.current);
			const intake = intakeValuesOf(values, today, rules);
			const result = await submit(
				toInquiryInput(
					intake,
					photos.map((item) => item.file),
					honeypot.current?.value ?? "",
					flashDesignId,
				),
			);
			if (result.kind === "busy") return;
			if (result.kind === "sent") {
				setSent({
					artistName: snapshotOf(values).artistName,
					dates: intake.preferredDates,
					reference: result.receipt.reference,
				});
				setSentTo(values.contactPhone.trim());
				form.reset();
				dispatch({ type: "cleared" });
				setFocus("sent");
				return;
			}
			const problem =
				result.kind === "challenge"
					? describeChallengeFailure(result.reason)
					: describeSubmitError(result.error, {
							sentArtistId: values.preferredArtistId || null,
							sentFlash: flashDesignId !== null,
							artistName: (id) =>
								artists.find((artist) => artist.id === id)?.name ?? null,
						});
			if (problem.kind === "fields") {
				const named = Object.keys(problem.fields).map((name) =>
					bookingFieldOf(name as IntakeField | DetailField),
				);
				for (const [name, message] of Object.entries(problem.fields)) {
					form.setFieldMeta(
						bookingFieldOf(name as IntakeField | DetailField),
						(meta) => ({
							...meta,
							isTouched: true,
							errorMap: { ...meta.errorMap, onServer: message },
						}),
					);
				}
				dispatch({
					type: "rejected",
					sentIds: photos.map((item) => item.id),
					byIndex: problem.photos,
					error: problem.photosError,
				});
				// The API refused a field: go to its step (a refused photo is the tattoo's).
				const target =
					steps.find((each) =>
						STEP_FIELDS[each].some((field) => named.includes(field)),
					) ??
					(problem.photosError || Object.keys(problem.photos).length > 0
						? "tattoo"
						: step);
				setStep(target);
				setSummaryFields(STEP_FIELDS[target]);
				setShowSummary(true);
				setFocus("summary");
				return;
			}
			if (problem.waitSeconds !== null) {
				setBlockedUntil(Date.now() + problem.waitSeconds * 1000);
			}
			setNotice(problem);
			setFocus("notice");
		} catch {
			// Something unexpected threw (the submitter already reset the widget):
			// say so, with every answer and photo kept, instead of going quiet.
			setNotice(unexpectedProblem());
			setFocus("notice");
		} finally {
			setPhase("idle");
			inFlight.current = false;
		}
	}

	// The latest photos for the async work, and a send waiting for them woken.
	useEffect(() => {
		latest.current = references;
		if (!isPreparing(references)) {
			for (const done of photoWaiters.current.splice(0)) done();
		}
	}, [references]);

	// Prepare queued photos one at a time (spec ruling 5).
	useEffect(() => {
		const next = nextToPrepare(references);
		if (!next?.source) return;
		const { id, source } = next;
		dispatch({ type: "started", id });
		void prepareReference(source, browserCodec).then((result) =>
			dispatch(
				result.ok
					? { type: "prepared", id, file: result.file }
					: { type: "refused", id, problem: result.problem },
			),
		);
	}, [references]);

	// One preview URL per ready photo, revoked when the photo goes.
	useEffect(() => {
		previewUrls.current = syncPreviews(
			previewUrls.current,
			references,
			BROWSER_URLS,
		);
		setPreviews(previewUrls.current);
	}, [references]);

	useEffect(
		() => () => {
			for (const url of previewUrls.current.values()) URL.revokeObjectURL(url);
			previewUrls.current = new Map();
		},
		[],
	);

	useEffect(() => {
		sendRef.current = createInquiry.mutateAsync;
	}, [createInquiry.mutateAsync]);

	useEffect(() => {
		challenge?.attach(challengeBox.current);
		return () => challenge?.dispose();
	}, [challenge]);

	useEffect(() => {
		if (focus === null) return;
		const target =
			focus === "summary"
				? summaryRef.current
				: focus === "notice"
					? noticeRef.current
					: focus === "step"
						? stepTitle.current
						: sentRef.current;
		target?.focus();
		setFocus(null);
	}, [focus]);

	useEffect(() => {
		if (phase !== "sending") {
			setSlow(false);
			return;
		}
		const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
		return () => window.clearTimeout(timer);
	}, [phase]);

	// Leaving while an inquiry is on its way asks first (spec ruling 7).
	useEffect(() => {
		if (phase === "idle" || phase === "preparing") return;
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [phase]);

	useEffect(() => {
		if (blockedUntil === null) return;
		const timer = window.setTimeout(
			() => {
				setBlockedUntil(null);
				setNotice(afterBlockEnds);
			},
			Math.max(0, blockedUntil - Date.now()),
		);
		return () => window.clearTimeout(timer);
	}, [blockedUntil]);

	if (sentTo !== null) {
		return (
			<BookingSent
				ref={sentRef}
				studioName={studioName}
				phone={sentTo}
				artistName={sent?.artistName ?? null}
				dates={sent?.dates ?? ""}
				reference={sent?.reference ?? null}
			/>
		);
	}

	const busy = phase !== "idle";
	const blocked = blockedUntil !== null;
	const warm = () => challenge?.preload();
	const index = steps.indexOf(step);
	const words = bookingCopy;

	return (
		<form
			className="intake booking"
			method="post"
			noValidate
			aria-labelledby="inquiry-title"
			onFocusCapture={warm}
			onPointerDownCapture={warm}
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				// Enter in a field continues; only the review step sends.
				if (step !== "review") {
					goNext();
					return;
				}
				if (!busy && !blocked) void form.handleSubmit();
			}}
		>
			{/* The same rule as the beforeunload listener above, for in-app links. */}
			<LeaveGuard
				active={phase !== "idle" && phase !== "preparing"}
				message={copy.status.leaveWhileSending}
			/>
			<p className="intake-note intake-reassure">
				<Fill template={copy.reassurance} values={{ studio: studioName }} />
			</p>
			<BookingProgress
				steps={steps}
				current={step}
				reached={reached}
				onGo={goTo}
				disabled={busy}
			/>
			<div className="booking-layout">
				<form.Subscribe selector={(formState) => formState.values}>
					{(values) => (
						<BookingSummary
							snapshot={snapshotOf(values)}
							studioName={studioName}
							showArtist={showArtists}
						/>
					)}
				</form.Subscribe>
				<div className="booking-main">
					<form.Subscribe selector={(formState) => formState.fieldMeta}>
						{(fieldMeta) => {
							const items = bookingSummaryItems(
								fieldMeta,
								summaryFields,
								references,
								studioName,
								photosStopped,
							);
							return showSummary && items.length > 0 ? (
								<ErrorSummary ref={summaryRef} items={items} />
							) : null;
						}}
					</form.Subscribe>
					{notice ? (
						<ProblemNotice
							ref={noticeRef}
							problem={notice}
							studioName={studioName}
							channels={channels}
						/>
					) : null}

					{steps.map((each) => (
						<section
							key={each}
							className="booking-step"
							hidden={each !== step}
							aria-labelledby={`booking-step-${each}`}
						>
							<h2
								id={`booking-step-${each}`}
								ref={each === step ? stepTitle : undefined}
								className="booking-step-title"
								tabIndex={-1}
							>
								{words.titles[each]}
							</h2>
							{each === "artist" ? (
								<form.Field name="preferredArtistId">
									{(field) => (
										<ArtistChoice
											artists={cards}
											studioName={studioName}
											value={field.state.value}
											onChange={(id) => field.handleChange(id)}
											invalid={
												field.state.meta.isTouched && !field.state.meta.isValid
											}
											error={firstMessage(field.state.meta.errors) ?? null}
										/>
									)}
								</form.Field>
							) : null}
							{each === "when" ? (
								<div className="booking-fields">
									<form.Field name="days">
										{(field) => (
											<form.Subscribe
												selector={(formState) => formState.values.flexible}
											>
												{(flexible) =>
													flexible ? null : (
														<PreferredDates
															value={field.state.value}
															onChange={(days) => field.handleChange(days)}
															today={today}
															rules={rules}
															studioName={studioName}
															invalid={
																field.state.meta.isTouched &&
																!field.state.meta.isValid
															}
															error={
																firstMessage(field.state.meta.errors) ?? null
															}
														/>
													)
												}
											</form.Subscribe>
										)}
									</form.Field>
									<form.Field name="flexible">
										{(field) => (
											<label className="booking-check" htmlFor="flexible">
												<input
													id="flexible"
													type="checkbox"
													checked={field.state.value}
													onChange={(event) => {
														field.handleChange(event.target.checked);
														// The days' message goes with the days.
														form.setFieldMeta("days", (meta) => ({
															...meta,
															isTouched: false,
														}));
													}}
												/>
												<span>
													<Fill
														template={words.when.flexible}
														values={{ studio: studioName }}
													/>
												</span>
											</label>
										)}
									</form.Field>
									<form.AppField name="timeOfDay">
										{(field) => (
											<field.ChoiceField
												legend={words.when.timeOfDay}
												options={TIMES_OF_DAY.map((time) => ({
													value: time,
													label: BOOKING_WORDS.timeOfDay[time],
												}))}
											/>
										)}
									</form.AppField>
								</div>
							) : null}
							{each === "tattoo" ? (
								<div className="booking-fields">
									<form.AppField name="idea">
										{(field) => (
											<field.TextareaField
												label={copy.fields.idea.label}
												description={copy.fields.idea.hint}
												rows={5}
												dir="auto"
												required
												aria-required="true"
											/>
										)}
									</form.AppField>
									{booking.styles.length > 0 ? (
										<form.AppField name="style">
											{(field) => (
												<field.ChoiceField
													legend={words.tattoo.style}
													description={words.tattoo.styleHint}
													options={[
														{ value: "", label: words.tattoo.anyStyle },
														...booking.styles.map((style) => ({
															value: style.slug,
															label: style.name,
														})),
													]}
												/>
											)}
										</form.AppField>
									) : null}
									<form.AppField name="colour">
										{(field) => (
											<field.ChoiceField
												legend={words.tattoo.colour}
												options={COLOURS.map((colour) => ({
													value: colour,
													label: BOOKING_WORDS.colour[colour],
												}))}
											/>
										)}
									</form.AppField>
									<ReferencePicker
										state={references}
										previews={previews}
										studioName={studioName}
										disabled={busy}
										onPick={(files) => {
											setPhotosStopped(false);
											dispatch({
												type: "picked",
												files: files.map((file) => ({
													id: `photo-${nextPhotoId.current++}`,
													file,
												})),
											});
										}}
										onRemove={(id) => {
											setPhotosStopped(false);
											dispatch({ type: "removed", id });
										}}
									/>
									<form.AppField name="size">
										{(field) => (
											<field.ChoiceField
												legend={words.tattoo.size}
												description={words.tattoo.sizeHint}
												options={SIZES.map((size) => ({
													value: size,
													label: BOOKING_WORDS.size[size],
												}))}
												required
											/>
										)}
									</form.AppField>
									<form.AppField name="approximateSize">
										{(field) => (
											<field.TextField
												label={words.tattoo.sizeDetails}
												description={words.tattoo.sizeDetailsHint}
												maxLength={INTAKE_LIMITS.approximateSize}
												dir="auto"
											/>
										)}
									</form.AppField>
									<form.AppField name="placement">
										{(field) => (
											<field.TextField
												label={copy.fields.placement.label}
												description={copy.fields.placement.hint}
												maxLength={INTAKE_LIMITS.placement}
												dir="auto"
												required
												aria-required="true"
											/>
										)}
									</form.AppField>
									<form.AppField name="budget">
										{(field) => (
											<field.TextField
												label={copy.fields.budget.label}
												description={copy.fields.budget.hint}
												maxLength={INTAKE_LIMITS.budget}
												dir="auto"
											/>
										)}
									</form.AppField>
									<form.AppField name="notes">
										{(field) => (
											<field.TextareaField
												label={words.tattoo.notes}
												description={words.tattoo.notesHint}
												rows={3}
												maxLength={BOOKING_LIMITS.notes}
												dir="auto"
											/>
										)}
									</form.AppField>
								</div>
							) : null}
							{each === "details" ? (
								<div className="booking-fields">
									<p className="intake-note">{copy.required}</p>
									<form.AppField name="contactName">
										{(field) => (
											<field.TextField
												label={copy.fields.contactName.label}
												autoComplete="name"
												maxLength={INTAKE_LIMITS.contactName}
												dir="auto"
												required
												aria-required="true"
											/>
										)}
									</form.AppField>
									<form.AppField name="contactPhone">
										{(field) => (
											<field.TextField
												label={copy.fields.contactPhone.label}
												description={
													<Fill
														template={copy.fields.contactPhone.hint ?? ""}
														values={{ studio: studioName }}
													/>
												}
												type="tel"
												inputMode="tel"
												autoComplete="tel"
												maxLength={INTAKE_LIMITS.contactPhone}
												required
												aria-required="true"
											/>
										)}
									</form.AppField>
									<form.AppField name="contactEmail">
										{(field) => (
											<field.TextField
												label={copy.fields.contactEmail.label}
												type="email"
												inputMode="email"
												autoComplete="email"
												maxLength={INTAKE_LIMITS.contactEmail}
											/>
										)}
									</form.AppField>
									<form.AppField name="sourceChannel">
										{(field) => (
											<field.ChoiceField
												legend={
													<Fill
														template={copy.fields.sourceChannel.label}
														values={{ studio: studioName }}
													/>
												}
												options={SOURCE_CHANNELS.map((channel) => ({
													value: channel,
													label: copy.channels[channel],
												}))}
												required
											/>
										)}
									</form.AppField>
								</div>
							) : null}
							{each === "review" && step === "review" ? (
								<form.Subscribe selector={(formState) => formState.values}>
									{(values) => (
										<BookingReview
											snapshot={snapshotOf(values)}
											studioName={studioName}
											steps={steps}
											onEdit={goTo}
											disabled={busy}
										/>
									)}
								</form.Subscribe>
							) : null}
						</section>
					))}

					{/* TAT-55's honeypot: off-screen (not display: none), never filled by the form. */}
					<div className="intake-trap" aria-hidden="true">
						<label htmlFor="intake-website">{copy.honeypot}</label>
						<input
							ref={honeypot}
							id="intake-website"
							type="text"
							name={INQUIRY_HONEYPOT_FIELD}
							tabIndex={-1}
							autoComplete="off"
							defaultValue=""
						/>
					</div>

					{step === "review" ? (
						<p className="booking-notice">{words.review.notice}</p>
					) : null}
					<div ref={challengeBox} className="intake-challenge" />

					<div className="booking-nav">
						{index > 0 ? (
							<button
								type="button"
								className="action action-secondary booking-back"
								onClick={() => goTo(steps[index - 1])}
								disabled={busy}
							>
								{words.nav.back}
							</button>
						) : null}
						{step === "review" ? (
							<button
								type="submit"
								className="action action-primary booking-send"
								aria-disabled={busy || blocked ? true : undefined}
							>
								{busy ? words.review.sending : words.review.submit}
							</button>
						) : (
							<button
								type="submit"
								className="action action-primary booking-next"
							>
								{words.nav.next}
							</button>
						)}
					</div>
					{step === "details" || step === "review" ? (
						// Who sees what, and the bot check, where the details are given and sent.
						<p className="intake-fine">
							<Fill template={copy.privacy} values={{ studio: studioName }} />{" "}
							<a href={TURNSTILE_PRIVACY_URL} rel="noopener noreferrer">
								{copy.privacyLink}
							</a>
						</p>
					) : null}
					{step === "review" ? (
						<SubmitStatus
							phase={phase}
							slow={slow}
							photoCount={readyItems(references).length}
							bytes={totalBytes(references)}
						/>
					) : null}
					{hasChannels(channels) ? (
						<p className="intake-chat">
							{copy.chat} <ChatLinks channels={channels} />
						</p>
					) : null}
				</div>
			</div>
		</form>
	);
}

/**
 * Every problem with the values, by the flow's fields: the intake's own rules
 * on what will be sent (intakeValuesOf) and the dates' and size's messages on
 * their choices.
 */
export function bookingErrors(
	values: BookingValues,
	today: string,
	booking: BookingContext,
	rules: { studioName: string; artistIds: readonly string[] },
): Partial<Record<BookingField, string>> {
	const errors: Partial<Record<BookingField, string>> = {};
	const intake = validateIntake(
		intakeValuesOf(values, today, booking.calendar),
		rules,
	);
	for (const [field, message] of Object.entries(intake)) {
		if (!message) continue;
		// Too long with the choice: the client's own words are what to shorten.
		const ownWords =
			field === "approximateSize" &&
			values.approximateSize.trim() !== "" &&
			sizeText(values).length > INTAKE_LIMITS.approximateSize;
		errors[
			ownWords ? "approximateSize" : bookingFieldOf(field as IntakeField)
		] = message;
	}
	return errors;
}

/** The flow's fields in the order a step shows them, for the summary. */
const BOOKING_FIELD_ORDER: readonly BookingField[] = [
	"preferredArtistId",
	"days",
	"idea",
	"style",
	"colour",
	"size",
	"approximateSize",
	"placement",
	"budget",
	"notes",
	"contactName",
	"contactPhone",
	"contactEmail",
	"sourceChannel",
];

const BOOKING_LABELS: Partial<Record<BookingField, string>> = {
	days: bookingCopy.steps.when,
	style: bookingCopy.tattoo.style,
	colour: bookingCopy.tattoo.colour,
	notes: bookingCopy.tattoo.notes,
	size: bookingCopy.tattoo.size,
	approximateSize: bookingCopy.tattoo.sizeDetails,
};

/** The flow's inputs, by form field name. */
type BookingInput = keyof BookingValues;

/** The field whose refusal the API reports for a composed value: its parts clear it when they change. */
const COMPOSED_FROM: Partial<Record<BookingInput, BookingField>> = {
	approximateSize: "size",
	flexible: "days",
	timeOfDay: "days",
};

/** The summary for the fields of one step: each one's first error, then (on the tattoo step) the photos'. */
export function bookingSummaryItems(
	fieldMeta: FieldMetaMap,
	fields: readonly BookingField[],
	references: ReferencesState,
	studioName: string,
	photosStopped = false,
): SummaryItem[] {
	const items: SummaryItem[] = [];
	for (const field of BOOKING_FIELD_ORDER) {
		if (!fields.includes(field)) continue;
		const message = firstMessage(fieldMeta[field]?.errors);
		if (message) {
			const own = BOOKING_LABELS[field];
			items.push({
				target:
					CHOICE_FIELDS.has(field as IntakeField) ||
					field === "size" ||
					field === "style" ||
					field === "colour"
						? `${field}-0`
						: field,
				label: own ?? (
					<Fill
						template={copy.fields[field as IntakeField].label}
						values={{ studio: studioName }}
					/>
				),
				message,
			});
		}
		// The photo picker follows the colour choice on the tattoo step.
		if (field === "colour" && (hasPhotoErrors(references) || photosStopped)) {
			items.push({
				target: canAdd(references) ? "references-input" : "references",
				label: copy.photos.legend,
				message: hasPhotoErrors(references)
					? (references.error ?? copy.photos.fixPhotos)
					: copy.photos.stopped,
			});
		}
	}
	return items;
}

/** A field's API error goes as soon as the person changes that field. */
function clearServerError(field: AnyFieldApi): void {
	if (field.state.meta.errorMap.onServer === undefined) return;
	field.setMeta((meta) => ({
		...meta,
		errorMap: { ...meta.errorMap, onServer: undefined },
	}));
}

type FieldMetaMap = Readonly<
	Record<string, { readonly errors?: readonly unknown[] } | undefined>
>;

/** Each field's first error, in the form's order, then the photos' (after the idea). */
export function summaryItems(
	fieldMeta: FieldMetaMap,
	references: ReferencesState,
	studioName: string,
	photosStopped = false,
): SummaryItem[] {
	const items: SummaryItem[] = [];
	for (const field of FIELD_ORDER) {
		const message = firstMessage(fieldMeta[field]?.errors);
		if (message) {
			items.push({
				target: CHOICE_FIELDS.has(field) ? `${field}-0` : field,
				label: (
					<Fill
						template={copy.fields[field].label}
						values={{ studio: studioName }}
					/>
				),
				message,
			});
		}
		if (field === "idea" && (hasPhotoErrors(references) || photosStopped)) {
			items.push({
				target: canAdd(references) ? "references-input" : "references",
				label: copy.photos.legend,
				message: hasPhotoErrors(references)
					? (references.error ?? copy.photos.fixPhotos)
					: copy.photos.stopped,
			});
		}
	}
	return items;
}

function firstMessage(
	errors: readonly unknown[] | undefined,
): string | undefined {
	for (const error of errors ?? []) {
		if (typeof error === "string" && error) return error;
		if (
			typeof error === "object" &&
			error !== null &&
			"message" in error &&
			typeof error.message === "string" &&
			error.message
		) {
			return error.message;
		}
	}
	return undefined;
}
