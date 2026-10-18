import { type AnyFieldApi, revalidateLogic } from "@tanstack/react-form";
import { useCreateInquiry } from "@tattoo-drip/react";
import {
	type CreateInquiryInput,
	INQUIRY_HONEYPOT_FIELD,
	type InquiryReceipt,
} from "@tattoo-drip/sdk";
import { useEffect, useReducer, useRef, useState } from "react";
import { useAppForm } from "../../components/ui/form.tsx";
import type { InquiryChannels, InquiryState } from "../../studio/inquiry.ts";
import { browserCodec } from "../browser-codec.ts";
import { Challenge, TURNSTILE_PRIVACY_URL } from "../challenge.ts";
import { browserChallengeHost } from "../challenge-host.ts";
import { copy } from "../copy.ts";
import { prepareReference } from "../images.ts";
import {
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
	FIELD_ORDER,
	INTAKE_LIMITS,
	type IntakeField,
	type IntakeValues,
	initialValues,
	SOURCE_CHANNELS,
	validateIntake,
} from "../rules.ts";
import { toInquiryInput } from "../submission.ts";
import { createSubmitter } from "../submit-flow.ts";
import { Fill } from "./fill.tsx";
import {
	ChatLinks,
	ErrorSummary,
	type FormPhase,
	hasChannels,
	IntakeSent,
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
}: IntakeFormProps) {
	const { studioName, preferredArtist, artists } = state;
	const showArtists = artists.length >= 2 || preferredArtist !== null;
	const createInquiry = useCreateInquiry();

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
	const [focus, setFocus] = useState<"summary" | "notice" | "sent" | null>(
		null,
	);

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
		defaultValues: initialValues(preferredArtist?.id ?? null),
		validationLogic: revalidateLogic({
			mode: "submit",
			modeAfterSubmission: "change",
		}),
		validators: {
			onDynamic: ({ value }: { value: IntakeValues }) => {
				const fields = validateIntake(value, {
					studioName,
					artistIds: artists.map((artist) => artist.id),
				});
				return Object.keys(fields).length > 0 ? { fields } : undefined;
			},
		},
		listeners: {
			onChange: ({ fieldApi }) => clearServerError(fieldApi),
		},
		onSubmit: ({ value }) => send(value),
		onSubmitInvalid: () => {
			setShowSummary(true);
			setFocus("summary");
		},
	});

	async function send(values: IntakeValues): Promise<void> {
		if (inFlight.current) return;
		if (blockedUntil !== null && Date.now() < blockedUntil) return;
		inFlight.current = true;
		try {
			setNotice(null);
			setShowSummary(false);
			setPhotosStopped(false);
			if (hasPhotoErrors(latest.current)) {
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
					setShowSummary(true);
					setFocus("summary");
					return;
				}
			}
			const sent = readyItems(latest.current);
			const result = await submit(
				toInquiryInput(
					values,
					sent.map((item) => item.file),
					honeypot.current?.value ?? "",
				),
			);
			if (result.kind === "busy") return;
			if (result.kind === "sent") {
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
							artistName: (id) =>
								artists.find((artist) => artist.id === id)?.name ?? null,
						});
			if (problem.kind === "fields") {
				for (const [name, message] of Object.entries(problem.fields)) {
					form.setFieldMeta(name as IntakeField, (meta) => ({
						...meta,
						isTouched: true,
						errorMap: { ...meta.errorMap, onServer: message },
					}));
				}
				dispatch({
					type: "rejected",
					sentIds: sent.map((item) => item.id),
					byIndex: problem.photos,
					error: problem.photosError,
				});
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
			() => setBlockedUntil(null),
			Math.max(0, blockedUntil - Date.now()),
		);
		return () => window.clearTimeout(timer);
	}, [blockedUntil]);

	if (sentTo !== null) {
		return (
			<IntakeSent
				ref={sentRef}
				studioName={studioName}
				phone={sentTo}
				channels={channels}
			/>
		);
	}

	const busy = phase !== "idle";
	const blocked = blockedUntil !== null;
	const warm = () => challenge?.preload();

	return (
		<form
			className="intake"
			method="post"
			noValidate
			aria-labelledby="inquiry-title"
			onFocusCapture={warm}
			onPointerDownCapture={warm}
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				if (!busy && !blocked) void form.handleSubmit();
			}}
		>
			<p className="intake-note">{copy.required}</p>
			<p className="intake-note">
				<Fill template={copy.privacy} values={{ studio: studioName }} />{" "}
				<a href={TURNSTILE_PRIVACY_URL} rel="noopener noreferrer">
					{copy.privacyLink}
				</a>
			</p>

			<form.Subscribe selector={(formState) => formState.fieldMeta}>
				{(fieldMeta) => {
					const items = summaryItems(
						fieldMeta,
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

			<fieldset className="intake-group">
				<legend className="intake-legend">{copy.tattooLegend}</legend>
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
				<div className="intake-pair">
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
					<form.AppField name="approximateSize">
						{(field) => (
							<field.TextField
								label={copy.fields.approximateSize.label}
								description={copy.fields.approximateSize.hint}
								maxLength={INTAKE_LIMITS.approximateSize}
								dir="auto"
								required
								aria-required="true"
							/>
						)}
					</form.AppField>
				</div>
				<form.AppField name="preferredDates">
					{(field) => (
						<field.TextField
							label={copy.fields.preferredDates.label}
							description={copy.fields.preferredDates.hint}
							maxLength={INTAKE_LIMITS.preferredDates}
							dir="auto"
							required
							aria-required="true"
						/>
					)}
				</form.AppField>
				{showArtists ? (
					<form.AppField name="preferredArtistId">
						{(field) => (
							<field.ChoiceField
								legend={copy.fields.preferredArtistId.label}
								options={[
									{ value: "", label: copy.noPreference },
									...artists.map((artist) => ({
										value: artist.id,
										label: artist.name,
									})),
								]}
							/>
						)}
					</form.AppField>
				) : null}
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
			</fieldset>

			<fieldset className="intake-group">
				<legend className="intake-legend">
					<Fill template={copy.contactLegend} values={{ studio: studioName }} />
				</legend>
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
			</fieldset>

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

			<div ref={challengeBox} className="intake-challenge" />

			<div className="intake-submit">
				<button
					type="submit"
					className="action action-primary"
					aria-disabled={busy || blocked ? true : undefined}
				>
					{busy ? copy.sending : copy.send}
				</button>
				<SubmitStatus
					phase={phase}
					slow={slow}
					photoCount={readyItems(references).length}
					bytes={totalBytes(references)}
				/>
			</div>
			{hasChannels(channels) ? (
				<p className="intake-chat">
					{copy.chat} <ChatLinks channels={channels} />
				</p>
			) : null}
		</form>
	);
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
