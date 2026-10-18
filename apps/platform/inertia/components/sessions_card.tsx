import { Form } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { useEffect, useId, useRef, useState } from "react";
import { urlFor } from "~/client";
import {
	SESSION_KIND_LABELS,
	SESSION_STATUS_LABELS,
	type SessionRow,
} from "~/components/projects";
import {
	ACTION_LABELS,
	OUTCOME_CONFIRMS,
	outcomeQuestion,
	type SessionAction,
	type SessionOutcomeName,
	sessionActions,
} from "~/components/sessions";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { useTenant } from "~/hooks/use-tenant";

/** The panel open under one session: an outcome's confirmation or the move form. */
type Open = { sessionId: string; action: SessionAction } | null;

/** The move form's first and last day, yyyy-MM-dd in the studio's timezone. */
type Dates = { today: string; max: string };

/**
 * The project's sessions and what staff record on them (TAT-85): done,
 * no-show or cancelled behind an inline confirmation, and a form to move a
 * session. Which buttons a row shows is the server's (the member may change
 * it, and it has started). One panel is open at a time; after a successful
 * save focus moves to the card's heading, so a screen reader lands on the
 * updated list.
 */
export default function SessionsCard({
	sessions,
	dates,
}: {
	sessions: SessionRow[];
	dates: Dates;
}) {
	const heading = useRef<HTMLHeadingElement>(null);
	const [open, setOpen] = useState<Open>(null);
	const done = () => {
		setOpen(null);
		heading.current?.focus();
	};

	return (
		<Card id="sessions">
			<CardHeader>
				<CardTitle>
					<h2 ref={heading} tabIndex={-1} className="outline-none">
						Sessions
					</h2>
				</CardTitle>
			</CardHeader>
			<CardContent>
				{sessions.length === 0 ? (
					<p className="text-sm text-muted-foreground">No sessions yet.</p>
				) : (
					<ul className="flex flex-col divide-y text-sm">
						{sessions.map((session) => (
							<SessionItem
								key={session.id}
								session={session}
								dates={dates}
								open={open?.sessionId === session.id ? open.action : null}
								onOpen={(action) => setOpen({ sessionId: session.id, action })}
								onClose={() => setOpen(null)}
								onDone={done}
							/>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}

function SessionItem({
	session,
	dates,
	open,
	onOpen,
	onClose,
	onDone,
}: {
	session: SessionRow;
	dates: Dates;
	open: SessionAction | null;
	onOpen: (action: SessionAction) => void;
	onClose: () => void;
	onDone: () => void;
}) {
	const triggers = useRef(new Map<SessionAction, HTMLButtonElement>());
	const actions = sessionActions(session.outcomes, session.move !== null);
	// Closing returns focus to the button that opened the panel.
	const close = () => {
		const trigger = open ? triggers.current.get(open) : undefined;
		onClose();
		trigger?.focus();
	};

	return (
		<li className="flex flex-col gap-3 py-3">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<span className="flex min-w-0 flex-col gap-0.5">
					<span>{session.whenText}</span>
					<span className="text-muted-foreground">
						{SESSION_KIND_LABELS[session.kind] ?? session.kind} with{" "}
						{session.artistName ?? "Unknown artist"}
					</span>
				</span>
				<Badge
					variant={session.status === "scheduled" ? "secondary" : "outline"}
				>
					{SESSION_STATUS_LABELS[session.status] ?? session.status}
				</Badge>
			</div>
			{session.awaitingBooking && (
				<p className="text-muted-foreground">
					It can be marked done once the project is booked.
				</p>
			)}
			{actions.length > 0 && (
				<fieldset className="flex min-w-0 flex-wrap gap-2">
					<legend className="sr-only">Session {session.whenText}</legend>
					{actions.map((action) => (
						<Button
							key={action}
							ref={(node) => {
								if (node) triggers.current.set(action, node);
								else triggers.current.delete(action);
							}}
							type="button"
							variant="outline"
							className="h-11"
							aria-expanded={open === action}
							onClick={() => onOpen(action)}
						>
							{ACTION_LABELS[action]}
						</Button>
					))}
				</fieldset>
			)}
			{open === "move" && session.move && (
				<MoveForm
					sessionId={session.id}
					whenText={session.whenText}
					values={session.move}
					dates={dates}
					onCancel={close}
					onDone={onDone}
				/>
			)}
			{open && open !== "move" && (
				<OutcomePanel
					sessionId={session.id}
					outcome={open}
					whenText={session.whenText}
					onCancel={close}
					onDone={onDone}
				/>
			)}
		</li>
	);
}

/**
 * Confirms an outcome: the question names the session and says it's final.
 * Focus starts on "Keep it scheduled", so pressing Enter right away changes
 * nothing; Escape closes the panel.
 */
function OutcomePanel({
	sessionId,
	outcome,
	whenText,
	onCancel,
	onDone,
}: {
	sessionId: string;
	outcome: SessionOutcomeName;
	whenText: string;
	onCancel: () => void;
	onDone: () => void;
}) {
	const tenant = useTenant();
	const keep = useRef<HTMLButtonElement>(null);
	const [saving, setSaving] = useState(false);
	useEffect(() => {
		keep.current?.focus();
	}, []);
	const confirm = () =>
		router.post(
			urlFor("tenant.sessions.outcome", { tenant: tenant.slug, id: sessionId }),
			{ status: outcome },
			{
				preserveScroll: true,
				onStart: () => setSaving(true),
				onFinish: () => setSaving(false),
				onSuccess: onDone,
			},
		);

	return (
		<fieldset
			className="min-w-0 rounded-md bg-muted/50 p-3"
			onKeyDown={(event) => {
				if (event.key === "Escape") onCancel();
			}}
		>
			<legend className="float-left mb-3 w-full">
				{outcomeQuestion(outcome, whenText)}
			</legend>
			<div className="clear-left flex flex-wrap gap-2">
				<Button
					type="button"
					className="h-11"
					disabled={saving}
					onClick={confirm}
				>
					{saving ? "Saving…" : OUTCOME_CONFIRMS[outcome]}
				</Button>
				<Button
					ref={keep}
					type="button"
					variant="ghost"
					className="h-11"
					disabled={saving}
					onClick={onCancel}
				>
					Keep it scheduled
				</Button>
			</div>
		</fieldset>
	);
}

/**
 * The new time: the booking form's three fields, prefilled with the
 * session's own. Focus starts on Date; Escape closes the form. After a
 * refused save it stays open with what was typed and the errors under
 * their fields.
 */
function MoveForm({
	sessionId,
	whenText,
	values,
	dates,
	onCancel,
	onDone,
}: {
	sessionId: string;
	whenText: string;
	values: NonNullable<SessionRow["move"]>;
	dates: Dates;
	onCancel: () => void;
	onDone: () => void;
}) {
	const tenant = useTenant();
	const id = useId();
	const date = useRef<HTMLInputElement>(null);
	useEffect(() => {
		date.current?.focus();
	}, []);
	const field = (name: string) => `${id}-${name}`;

	return (
		<Form
			route="tenant.sessions.move"
			routeParams={{ tenant: tenant.slug, id: sessionId }}
			options={{ preserveScroll: true }}
			onSuccess={onDone}
		>
			{({ errors, processing }) => (
				<fieldset
					className="min-w-0 rounded-md bg-muted/50 p-3"
					onKeyDown={(event) => {
						if (event.key === "Escape") onCancel();
					}}
				>
					<legend className="sr-only">Move the session on {whenText}</legend>
					<div className="grid gap-4 sm:grid-cols-3">
						<Field data-invalid={!!errors.date}>
							<FieldLabel htmlFor={field("date")}>Date</FieldLabel>
							<Input
								ref={date}
								id={field("date")}
								name="date"
								type="date"
								required
								min={dates.today}
								max={dates.max}
								defaultValue={values.date}
								aria-invalid={!!errors.date}
								aria-describedby={errors.date ? field("date-error") : undefined}
								className="h-11"
							/>
							{errors.date && (
								<FieldError id={field("date-error")}>{errors.date}</FieldError>
							)}
						</Field>
						<Field data-invalid={!!errors.startTime}>
							<FieldLabel htmlFor={field("startTime")}>Start time</FieldLabel>
							<Input
								id={field("startTime")}
								name="startTime"
								type="time"
								required
								defaultValue={values.startTime}
								aria-invalid={!!errors.startTime}
								aria-describedby={
									errors.startTime ? field("startTime-error") : undefined
								}
								className="h-11"
							/>
							{errors.startTime && (
								<FieldError id={field("startTime-error")}>
									{errors.startTime}
								</FieldError>
							)}
						</Field>
						<Field data-invalid={!!errors.hours}>
							<FieldLabel htmlFor={field("hours")}>Length (hours)</FieldLabel>
							<Input
								id={field("hours")}
								name="hours"
								type="number"
								inputMode="decimal"
								required
								min={0.25}
								max={12}
								step={0.25}
								defaultValue={values.hours}
								aria-invalid={!!errors.hours}
								aria-describedby={
									errors.hours ? field("hours-error") : field("hours-hint")
								}
								className="h-11"
							/>
							{errors.hours ? (
								<FieldError id={field("hours-error")}>
									{errors.hours}
								</FieldError>
							) : (
								<FieldDescription id={field("hours-hint")}>
									In quarter hours: 2.5 for two and a half.
								</FieldDescription>
							)}
						</Field>
					</div>
					<div className="mt-4 flex flex-wrap gap-2">
						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Saving…" : "Move session"}
						</Button>
						<Button
							type="button"
							variant="ghost"
							className="h-11"
							disabled={processing}
							onClick={onCancel}
						>
							Keep this time
						</Button>
					</div>
				</fieldset>
			)}
		</Form>
	);
}
