import { Form } from "@adonisjs/inertia/react";
import { Link, router } from "@inertiajs/react";
import { useState } from "react";
import { urlFor } from "~/client";
import {
	CLOSED_INTRO,
	DAY_NAMES,
	depositLine,
	HOURS_INTRO,
	NO_CLOSED_DAYS,
	removeLabel,
	TEXTS_INTRO,
	tickDay,
	type WeekRow,
	weekRows,
} from "~/components/good_to_know";
import Section from "~/components/section";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

type ClosedDay = { id: string; when: string; note: string | null };
type Texts = {
	walkIns: string | null;
	ageRule: string | null;
	beforeSession: string | null;
	aftercare: string | null;
};

/**
 * Settings, Good to know (TAT-128): the studio's opening hours, closed days
 * and four short texts for clients. Three forms on one page, so their field
 * names differ (a page shares one error bag): `hours[<day>][...]`,
 * `closedFrom` / `closedTo` / `closedNote`, and the four texts. The server
 * sends the whole week (a closed day carries the times ticking it offers)
 * and refuses what the rows can't check; this page holds only the rows
 * while they are edited.
 */
export default function GoodToKnow({
	timezone,
	week,
	closedDays,
	dates,
	texts,
	hasDepositPolicy,
}: {
	timezone: string;
	week: WeekRow[];
	closedDays: ClosedDay[];
	dates: { today: string; max: string };
	texts: Texts;
	hasDepositPolicy: boolean;
}) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug };

	return (
		<>
			<Section title="Opening hours" description={HOURS_INTRO(timezone)}>
				{/* Keyed by the stored week: a save remounts it with the stored values. */}
				<HoursForm key={JSON.stringify(week)} week={week} />
			</Section>

			<Section title="Closed days" description={CLOSED_INTRO}>
				<div className="flex flex-col gap-4">
					{closedDays.length === 0 ? (
						<p className="text-sm text-muted-foreground">{NO_CLOSED_DAYS}</p>
					) : (
						<ul className="divide-y rounded-md border">
							{closedDays.map((day) => (
								<li
									key={day.id}
									className="flex flex-wrap items-center gap-3 p-3"
								>
									<div className="flex min-w-40 flex-1 flex-col gap-1">
										<span className="font-medium">{day.when}</span>
										{day.note && (
											<span
												className="text-sm wrap-anywhere text-muted-foreground"
												dir="auto"
											>
												{day.note}
											</span>
										)}
									</div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										aria-label={removeLabel(day.when)}
										onClick={() =>
											router.delete(
												urlFor("tenant.settings.closed_days.destroy", {
													...params,
													id: day.id,
												}),
												{ preserveScroll: true },
											)
										}
									>
										Remove
									</Button>
								</li>
							))}
						</ul>
					)}
					<Form
						route="tenant.settings.closed_days.store"
						routeParams={params}
						resetOnSuccess
						options={{ preserveScroll: true }}
					>
						{({ errors, processing }) => (
							<FieldGroup>
								<div className="grid gap-4 lg:grid-cols-3">
									<Field data-invalid={!!errors.closedFrom}>
										<FieldLabel htmlFor="closedFrom">First day</FieldLabel>
										<Input
											id="closedFrom"
											name="closedFrom"
											type="date"
											required
											min={dates.today}
											max={dates.max}
											aria-invalid={!!errors.closedFrom}
											aria-describedby={
												errors.closedFrom ? "closedFrom-error" : undefined
											}
										/>
										{errors.closedFrom && (
											<FieldError id="closedFrom-error">
												{errors.closedFrom}
											</FieldError>
										)}
									</Field>
									<Field data-invalid={!!errors.closedTo}>
										<FieldLabel htmlFor="closedTo">
											Last day (optional)
										</FieldLabel>
										<Input
											id="closedTo"
											name="closedTo"
											type="date"
											min={dates.today}
											aria-invalid={!!errors.closedTo}
											aria-describedby={
												errors.closedTo ? "closedTo-error" : "closedTo-hint"
											}
										/>
										{errors.closedTo ? (
											<FieldError id="closedTo-error">
												{errors.closedTo}
											</FieldError>
										) : (
											<FieldDescription id="closedTo-hint">
												Leave it empty for one day.
											</FieldDescription>
										)}
									</Field>
									<Field data-invalid={!!errors.closedNote}>
										<FieldLabel htmlFor="closedNote">
											Note (optional)
										</FieldLabel>
										<Input
											id="closedNote"
											name="closedNote"
											maxLength={120}
											placeholder="Closed for Dashain, back on 28 October"
											dir="auto"
											aria-invalid={!!errors.closedNote}
											aria-describedby={
												errors.closedNote ? "closedNote-error" : undefined
											}
										/>
										{errors.closedNote && (
											<FieldError id="closedNote-error">
												{errors.closedNote}
											</FieldError>
										)}
									</Field>
								</div>
								<div>
									<Button type="submit" disabled={processing}>
										{processing ? "Adding…" : "Add closed days"}
									</Button>
								</div>
							</FieldGroup>
						)}
					</Form>
				</div>
			</Section>

			<Section title="For clients" description={TEXTS_INTRO}>
				<Form
					route="tenant.settings.good_to_know.update"
					routeParams={params}
					options={{ preserveScroll: true }}
				>
					{({ errors, processing }) => (
						<FieldGroup>
							<TextField
								name="walkIns"
								label="Walk-ins"
								rows={2}
								max={300}
								value={texts.walkIns}
								placeholder="Welcome for small flash. Bigger pieces need a booking."
								error={errors.walkIns}
							/>
							<TextField
								name="ageRule"
								label="Age"
								rows={2}
								max={200}
								value={texts.ageRule}
								placeholder="18 and over, with a photo ID."
								error={errors.ageRule}
							/>
							<TextField
								name="beforeSession"
								label="Before your session"
								rows={5}
								max={2000}
								value={texts.beforeSession}
								placeholder="Eat a good meal, sleep well and wear clothes that leave the spot free."
								error={errors.beforeSession}
							/>
							<TextField
								name="aftercare"
								label="Aftercare"
								rows={5}
								max={2000}
								value={texts.aftercare}
								placeholder="Keep the wrap on for 2 hours, then wash gently with clean water and mild soap."
								error={errors.aftercare}
							/>
							<p className="text-sm text-muted-foreground">
								{depositLine(hasDepositPolicy)}{" "}
								<Link
									href={urlFor("tenant.settings.payments", params)}
									className="underline underline-offset-4"
								>
									Payments
								</Link>
							</p>
							<div>
								<Button type="submit" disabled={processing}>
									{processing ? "Saving…" : "Save"}
								</Button>
							</div>
						</FieldGroup>
					)}
				</Form>
			</Section>
		</>
	);
}

/**
 * The week as seven rows, Sunday first: a checkbox with the full day name,
 * and two time boxes while the day is ticked. A ticked day sends a hidden
 * `open` field (so what is sent never depends on how the checkbox
 * submits); the checkbox itself has no name.
 */
function HoursForm({ week }: { week: WeekRow[] }) {
	const tenant = useTenant();
	const [rows, setRows] = useState(() => weekRows(week));
	const edit = (index: number, change: Partial<WeekRow>) =>
		setRows((current) =>
			current.map((row, i) => (i === index ? { ...row, ...change } : row)),
		);

	return (
		<Form
			route="tenant.settings.hours.update"
			routeParams={{ tenant: tenant.slug }}
			options={{ preserveScroll: true }}
		>
			{({ errors, processing }) => (
				<FieldGroup>
					<fieldset className="flex min-w-0 flex-col gap-3">
						<legend className="sr-only">Opening hours</legend>
						{rows.map((row, index) => {
							const name = DAY_NAMES[row.day];
							const error = errors[`hours.${row.day}`];
							const errorId = `hours-${row.day}-error`;
							return (
								<div key={row.day} className="flex flex-col gap-1">
									<div className="grid gap-2 lg:grid-cols-[10rem_1fr_1fr] lg:items-center">
										<Field orientation="horizontal">
											<Checkbox
												id={`open-${row.day}`}
												checked={row.open}
												onCheckedChange={(checked) =>
													setRows((current) =>
														tickDay(current, index, checked === true),
													)
												}
											/>
											<FieldLabel
												htmlFor={`open-${row.day}`}
												className="font-normal"
											>
												{name}
											</FieldLabel>
										</Field>
										{row.open ? (
											<>
												<input
													type="hidden"
													name={`hours[${row.day}][open]`}
													value="1"
												/>
												<TimeBox
													day={row.day}
													kind="opens"
													visible="Opens"
													name={name}
													value={row.opens}
													invalid={!!error}
													describedBy={error ? errorId : undefined}
													onChange={(opens) => edit(index, { opens })}
												/>
												<TimeBox
													day={row.day}
													kind="closes"
													visible="Closes"
													name={name}
													value={row.closes}
													invalid={!!error}
													describedBy={error ? errorId : undefined}
													onChange={(closes) => edit(index, { closes })}
												/>
											</>
										) : (
											<p className="text-sm text-muted-foreground lg:col-span-2">
												Closed
											</p>
										)}
									</div>
									{error && <FieldError id={errorId}>{error}</FieldError>}
								</div>
							);
						})}
					</fieldset>
					<div>
						<Button type="submit" disabled={processing}>
							{processing ? "Saving…" : "Save hours"}
						</Button>
					</div>
				</FieldGroup>
			)}
		</Form>
	);
}

/** One time box: "Opens" or "Closes" on screen, "Opens Sunday" for a screen reader. */
function TimeBox({
	day,
	kind,
	visible,
	name,
	value,
	invalid,
	describedBy,
	onChange,
}: {
	day: string;
	kind: "opens" | "closes";
	visible: string;
	name: string;
	value: string;
	invalid: boolean;
	describedBy: string | undefined;
	onChange: (value: string) => void;
}) {
	const id = `${kind}-${day}`;
	return (
		<Field orientation="horizontal" data-invalid={invalid}>
			<FieldLabel htmlFor={id} className="w-16 font-normal">
				<span aria-hidden="true">{visible}</span>
				<span className="sr-only">
					{visible} {name}
				</span>
			</FieldLabel>
			<Input
				id={id}
				name={`hours[${day}][${kind}]`}
				type="time"
				required
				value={value}
				onChange={(event) => onChange(event.target.value)}
				aria-invalid={invalid}
				aria-describedby={describedBy}
			/>
		</Field>
	);
}

function TextField({
	name,
	label,
	rows,
	max,
	value,
	placeholder,
	error,
}: {
	name: string;
	label: string;
	rows: number;
	max: number;
	value: string | null;
	placeholder: string;
	error: string | undefined;
}) {
	return (
		<Field data-invalid={!!error}>
			<FieldLabel htmlFor={name}>{label}</FieldLabel>
			<Textarea
				id={name}
				name={name}
				rows={rows}
				maxLength={max}
				defaultValue={value ?? ""}
				placeholder={placeholder}
				dir="auto"
				aria-invalid={!!error}
				aria-describedby={error ? `${name}-error` : undefined}
			/>
			{error && <FieldError id={`${name}-error`}>{error}</FieldError>}
		</Field>
	);
}

GoodToKnow.layout = [AppLayout, SettingsLayout];
