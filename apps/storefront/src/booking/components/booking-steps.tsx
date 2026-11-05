import { type KeyboardEvent, useEffect, useState } from "react";
import { Fill } from "../../intake/components/fill.tsx";
import { fill } from "../../intake/template.ts";
import { addDays } from "../../studio/hours.ts";
import type { BookingArtist, BookingStep } from "../booking.ts";
import {
	type CalendarRules,
	dayState,
	HORIZON_DAYS,
	longDate,
	MAX_DAYS,
	type Month,
	monthOf,
	monthTitle,
	monthWeeks,
	sameMonth,
	shiftMonth,
	shortDate,
} from "../calendar.ts";
import { bookingCopy as copy } from "../copy.ts";

/*
 * The booking flow's step pieces (Prompt 6), for every theme: props in,
 * callbacks out, no API calls. The form (src/intake/components/intake-form.tsx)
 * owns the values and the validation; these only show them.
 */

/**
 * Where the client is: an ordered list of the steps, the current one
 * `aria-current="step"`; a step already passed is a button back to it, a
 * later one is text (it can't be skipped to). On a phone the list collapses
 * to "Step 2 of 5" and the current step's name.
 */
export function BookingProgress({
	steps,
	current,
	reached,
	onGo,
	disabled = false,
}: {
	steps: readonly BookingStep[];
	current: BookingStep;
	/** The furthest step reached: every step up to it can be gone back to. */
	reached: number;
	onGo: (step: BookingStep) => void;
	/** While the request is on its way: no step can be left. */
	disabled?: boolean;
}) {
	const index = steps.indexOf(current);
	return (
		<nav className="booking-progress" aria-label={copy.steps.label}>
			<p className="booking-progress-count">
				<Fill
					template={copy.steps.count}
					values={{ step: index + 1, count: steps.length }}
				/>
				<span aria-hidden="true"> · {copy.steps[current]}</span>
			</p>
			{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
			<ol
				className="booking-progress-list"
				// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
				role="list"
			>
				{steps.map((step, i) => (
					<li
						key={step}
						className="booking-progress-step"
						data-state={i < index ? "done" : i === index ? "current" : "later"}
						aria-current={i === index ? "step" : undefined}
					>
						{i !== index && i <= reached ? (
							<button
								type="button"
								onClick={() => onGo(step)}
								disabled={disabled}
							>
								<span className="booking-progress-n" aria-hidden="true">
									{i + 1}
								</span>
								<span>{copy.steps[step]}</span>
							</button>
						) : (
							<span className="booking-progress-label">
								<span className="booking-progress-n" aria-hidden="true">
									{i + 1}
								</span>
								<span>{copy.steps[step]}</span>
							</span>
						)}
					</li>
				))}
			</ol>
		</nav>
	);
}

/**
 * The artist step's choice: each artist who takes new work as a card
 * (portrait when they have one, name, first style) and "No preference", one
 * radio group. The value is the artist's id, "" for no preference.
 */
export function ArtistChoice({
	artists,
	studioName,
	value,
	onChange,
	invalid,
	error,
}: {
	artists: readonly BookingArtist[];
	studioName: string;
	value: string;
	onChange: (id: string) => void;
	invalid: boolean;
	error: string | null;
}) {
	return (
		<fieldset
			id="preferredArtistId"
			className="booking-artists"
			aria-describedby={
				invalid
					? "preferredArtistId-hint preferredArtistId-error"
					: "preferredArtistId-hint"
			}
		>
			<legend className="booking-legend">{copy.artist.legend}</legend>
			<p id="preferredArtistId-hint" className="booking-hint">
				<Fill template={copy.artist.hint} values={{ studio: studioName }} />
			</p>
			{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
			<ul
				className="booking-artist-list"
				// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
				role="list"
			>
				{artists.map((artist, index) => (
					<li key={artist.id}>
						<label className="booking-artist">
							<input
								type="radio"
								id={`preferredArtistId-${index}`}
								name="preferredArtistId"
								value={artist.id}
								checked={value === artist.id}
								onChange={() => onChange(artist.id)}
								aria-invalid={invalid || undefined}
							/>
							{artist.photo ? (
								<img
									className="booking-artist-photo"
									src={artist.photo.src}
									srcSet={artist.photo.srcSet}
									sizes={artist.photo.srcSet ? "6rem" : undefined}
									width={artist.photo.width}
									height={artist.photo.height}
									alt=""
									loading="lazy"
									decoding="async"
								/>
							) : (
								<span className="booking-artist-photo" aria-hidden="true" />
							)}
							<span className="booking-artist-text">
								<span className="booking-artist-name" dir="auto">
									{artist.name}
								</span>
								{artist.specialty ? (
									<span className="booking-artist-style">
										{artist.specialty}
									</span>
								) : null}
							</span>
						</label>
					</li>
				))}
				<li>
					<label className="booking-artist booking-artist-any">
						<input
							type="radio"
							id={`preferredArtistId-${artists.length}`}
							name="preferredArtistId"
							value=""
							checked={value === ""}
							onChange={() => onChange("")}
						/>
						<span className="booking-artist-photo" aria-hidden="true" />
						<span className="booking-artist-text">
							<span className="booking-artist-name">{copy.artist.any}</span>
							<span className="booking-artist-style">
								<Fill
									template={copy.artist.anyHint}
									values={{ studio: studioName }}
								/>
							</span>
						</span>
					</label>
				</li>
			</ul>
			{invalid && error ? (
				<p id="preferredArtistId-error" className="booking-error">
					{error}
				</p>
			) : null}
		</fieldset>
	);
}

/**
 * The preference calendar: a month of days, each a toggle button (a day the
 * studio's published week closes, a published closure, the past and beyond a
 * year are shown but can't be picked). One roving tab stop: the arrows move a
 * day or a week, Home and End to the week's ends, Page Up and Down a month.
 * Up to three days; the chosen ones are listed under it, each removable.
 */
export function PreferredDates({
	value,
	onChange,
	today,
	rules,
	studioName,
	invalid,
	error,
}: {
	value: readonly string[];
	onChange: (days: string[]) => void;
	/** The studio's date today (yyyy-MM-dd). */
	today: string;
	rules: CalendarRules;
	studioName: string;
	invalid: boolean;
	error: string | null;
}) {
	const first = addDays(today, 1);
	const [month, setMonth] = useState<Month>(() => monthOf(value[0] ?? first));
	const [focused, setFocused] = useState<string>(value[0] ?? first);
	const [moved, setMoved] = useState(false);
	const firstMonth = monthOf(first);
	const lastMonth = monthOf(addDays(today, HORIZON_DAYS));
	const full = value.length >= MAX_DAYS;

	// After an arrow key, the keyboard follows the focused day (one roving stop).
	useEffect(() => {
		if (moved) document.getElementById(`day-${focused}`)?.focus();
	}, [focused, moved]);

	function toggle(date: string) {
		if (value.includes(date)) {
			onChange(value.filter((day) => day !== date));
		} else if (!full && dayState(date, today, rules) === "open") {
			onChange([...value, date].sort());
		}
	}

	function move(event: KeyboardEvent<HTMLButtonElement>, date: string) {
		const by: Record<string, number> = {
			ArrowLeft: -1,
			ArrowRight: 1,
			ArrowUp: -7,
			ArrowDown: 7,
		};
		let next: string | null = null;
		if (event.key in by) next = addDays(date, by[event.key]);
		const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
		if (event.key === "Home") next = addDays(date, -weekday);
		if (event.key === "End") next = addDays(date, 6 - weekday);
		if (event.key === "PageUp") next = addDays(date, -28);
		if (event.key === "PageDown") next = addDays(date, 28);
		if (next === null) return;
		event.preventDefault();
		const target = monthOf(next);
		if (
			target.year * 12 + target.month <
				firstMonth.year * 12 + firstMonth.month ||
			target.year * 12 + target.month > lastMonth.year * 12 + lastMonth.month
		) {
			return;
		}
		setMonth(target);
		setFocused(next);
		setMoved(true);
	}

	const inMonth = sameMonth(monthOf(focused), month);
	const stop = inMonth
		? focused
		: (monthWeeks(month)
				.flat()
				.find((date) => date !== null) ?? focused);

	return (
		<div
			id="days"
			className="booking-calendar"
			tabIndex={-1}
			aria-describedby={invalid ? "days-hint days-error" : "days-hint"}
		>
			<p id="days-hint" className="booking-hint">
				<Fill
					template={copy.when.hint}
					values={{ max: MAX_DAYS, studio: studioName }}
				/>
			</p>
			<div className="booking-calendar-head">
				<button
					type="button"
					className="booking-calendar-step"
					onClick={() => setMonth(shiftMonth(month, -1))}
					disabled={sameMonth(month, firstMonth)}
					aria-label={copy.when.previous}
				>
					<span aria-hidden="true">‹</span>
				</button>
				<h3 className="booking-calendar-title" aria-live="polite">
					{monthTitle(month)}
				</h3>
				<button
					type="button"
					className="booking-calendar-step"
					onClick={() => setMonth(shiftMonth(month, 1))}
					disabled={sameMonth(month, lastMonth)}
					aria-label={copy.when.next}
				>
					<span aria-hidden="true">›</span>
				</button>
			</div>
			<table className="booking-calendar-grid">
				<thead>
					<tr>
						{copy.when.weekdays.map((day) => (
							<th key={day} scope="col" abbr={day}>
								{day.slice(0, 2)}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{monthWeeks(month).map((week) => (
						<tr key={week.find((date) => date !== null) ?? "week"}>
							{week.map((date, index) =>
								date === null ? (
									// biome-ignore lint/suspicious/noArrayIndexKey: an empty cell has no date; its place is its identity
									<td key={`empty-${index}`} />
								) : (
									<td key={date}>
										<DayButton
											date={date}
											state={dayState(date, today, rules)}
											chosen={value.includes(date)}
											full={full}
											studioName={studioName}
											tabStop={date === stop}
											onToggle={() => toggle(date)}
											onKey={(event) => move(event, date)}
											onFocus={() => setFocused(date)}
										/>
									</td>
								),
							)}
						</tr>
					))}
				</tbody>
			</table>
			{full ? (
				<p className="booking-hint">
					<Fill template={copy.when.full} values={{ max: MAX_DAYS }} />
				</p>
			) : null}
			{value.length > 0 ? (
				// biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none
				<ul
					className="booking-chosen"
					// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
					role="list"
				>
					{value.map((date) => (
						<li key={date}>
							<span>{shortDate(date)}</span>
							<button
								type="button"
								onClick={() => toggle(date)}
								aria-label={fill(copy.when.remove, { name: longDate(date) })}
							>
								<span aria-hidden="true">×</span>
							</button>
						</li>
					))}
				</ul>
			) : null}
			{invalid && error ? (
				<p id="days-error" className="booking-error">
					{error}
				</p>
			) : null}
		</div>
	);
}

function DayButton({
	date,
	state,
	chosen,
	full,
	studioName,
	tabStop,
	onToggle,
	onKey,
	onFocus,
}: {
	date: string;
	state: ReturnType<typeof dayState>;
	chosen: boolean;
	full: boolean;
	studioName: string;
	tabStop: boolean;
	onToggle: () => void;
	onKey: (event: KeyboardEvent<HTMLButtonElement>) => void;
	onFocus: () => void;
}) {
	const open = state === "open";
	const blocked = !chosen && (!open || full);
	const why =
		state === "closed" || state === "closure"
			? `, ${fill(copy.when.closed, { studio: studioName })}`
			: "";
	return (
		<button
			type="button"
			id={`day-${date}`}
			className="booking-day"
			data-state={chosen ? "chosen" : state}
			aria-pressed={chosen}
			aria-disabled={blocked || undefined}
			aria-label={`${longDate(date)}${why}`}
			tabIndex={tabStop ? 0 : -1}
			onClick={blocked ? undefined : onToggle}
			onKeyDown={onKey}
			onFocus={onFocus}
		>
			{Number(date.slice(8, 10))}
		</button>
	);
}
