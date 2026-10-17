import { Form, Link } from "@adonisjs/inertia/react";
import { cn } from "cn";
import { useState } from "react";
import { urlFor } from "~/client";
import type { BookingLookup, BookingPageProps } from "~/components/bookings";
import Page from "~/components/page";
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
import AppLayout from "~/layouts/app";

type Invalid = Extract<BookingLookup, { state: "invalid" }>;
type Looked = Extract<BookingLookup, { state: "found" | "new" }>;
type Errors = Partial<Record<string, string>>;
type PriceKind = "none" | "fixed" | "hourly";

/** docs/ui.md: touch targets are at least 44px (h-11), up from shadcn's 36px. */
const TARGET = "h-11";

const PRICE_KINDS: { value: PriceKind; title: string; description: string }[] =
	[
		{ value: "none", title: "No price", description: "Book without one." },
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

/** The id of a field's error message, for aria-describedby. */
const errorId = (name: string, errors: Errors) =>
	errors[name] ? `${name}-error` : undefined;

/** The day to carry through the lookup: only one the calendar chose. */
const carriedDate = (dates: BookingPageProps["dates"]) =>
	dates.initial === dates.today ? null : dates.initial;

/**
 * Books a walk-in, phone or DM client in one step (TAT-43): look the phone
 * up, then the client, the session and an optional price. The project
 * starts as Booked.
 */
export default function BookingNew({
	lookup,
	artists,
	isOwner,
	dates,
}: BookingPageProps) {
	return (
		<Page
			title="Book a session"
			description="For a walk-in, a call or a message. The project starts as Booked."
		>
			<div className="flex max-w-2xl flex-col gap-6">
				{artists.length === 0 ? (
					<NoArtist isOwner={isOwner} />
				) : lookup === null || lookup.state === "invalid" ? (
					<PhoneLookup invalid={lookup} date={carriedDate(dates)} />
				) : (
					<BookingForm
						lookup={lookup}
						artists={artists}
						isOwner={isOwner}
						dates={dates}
					/>
				)}
			</div>
		</Page>
	);
}

function NoArtist({ isOwner }: { isOwner: boolean }) {
	const tenant = useTenant();

	return (
		<Card>
			<CardContent className="flex flex-col items-start gap-3">
				<p className="text-sm">
					{isOwner
						? "Add an artist before booking a session: every session belongs to one."
						: "Only artists with their own profile can book sessions, and your account isn't linked to one yet."}
				</p>
				{isOwner && (
					<Link
						route="tenant.artists.create"
						routeParams={{ tenant: tenant.slug }}
						className={buttonVariants({ className: TARGET })}
					>
						Add an artist
					</Link>
				)}
			</CardContent>
		</Card>
	);
}

/** Step 1: a plain GET form, like the clients search; it reloads with ?phone=. */
function PhoneLookup({
	invalid,
	date,
}: {
	invalid: Invalid | null;
	date: string | null;
}) {
	const tenant = useTenant();

	return (
		<Card>
			<CardHeader>
				<CardTitle>Client</CardTitle>
			</CardHeader>
			<CardContent>
				<form
					method="get"
					action={urlFor("tenant.projects.create", { tenant: tenant.slug })}
				>
					{date && <input type="hidden" name="date" value={date} />}
					<Field data-invalid={!!invalid}>
						<FieldLabel htmlFor="phone">Client&apos;s phone</FieldLabel>
						<div className="flex gap-2">
							<Input
								id="phone"
								name="phone"
								type="tel"
								inputMode="tel"
								autoComplete="off"
								required
								defaultValue={invalid?.typed ?? ""}
								aria-invalid={!!invalid}
								aria-describedby={invalid ? "phone-error" : "phone-hint"}
								className={cn("flex-1", TARGET)}
							/>
							<Button type="submit" className={TARGET}>
								Find client
							</Button>
						</div>
						{invalid ? (
							<FieldError id="phone-error">{invalid.message}</FieldError>
						) : (
							<FieldDescription id="phone-hint">
								A returning client is found by their number, so their history
								stays together.
							</FieldDescription>
						)}
					</Field>
				</form>
			</CardContent>
		</Card>
	);
}

/** Step 2: the client the lookup found (or a new one), the session and the price. */
function BookingForm({
	lookup,
	artists,
	isOwner,
	dates,
}: {
	lookup: Looked;
	artists: BookingPageProps["artists"];
	isOwner: boolean;
	dates: BookingPageProps["dates"];
}) {
	const tenant = useTenant();
	const [priceKind, setPriceKind] = useState<PriceKind>("none");

	return (
		<Form route="tenant.projects.store" routeParams={{ tenant: tenant.slug }}>
			{({ errors, processing }) => (
				<div className="flex flex-col gap-6">
					<ClientCard
						lookup={lookup}
						isOwner={isOwner}
						errors={errors}
						date={carriedDate(dates)}
					/>
					<SessionCard
						artists={artists}
						isOwner={isOwner}
						dates={dates}
						errors={errors}
					/>
					<PriceCard
						priceKind={priceKind}
						onChange={setPriceKind}
						errors={errors}
					/>
					<div className="flex flex-wrap items-center gap-2">
						<Button type="submit" disabled={processing} className={TARGET}>
							{processing ? "Saving…" : "Book session"}
						</Button>
						<Link
							route="tenant.projects.index"
							routeParams={{ tenant: tenant.slug }}
							className={buttonVariants({
								variant: "ghost",
								className: TARGET,
							})}
						>
							Cancel
						</Link>
					</div>
				</div>
			)}
		</Form>
	);
}

function ClientCard({
	lookup,
	isOwner,
	errors,
	date,
}: {
	lookup: Looked;
	isOwner: boolean;
	errors: Errors;
	date: string | null;
}) {
	const tenant = useTenant();
	const problem = errors.clientId ?? errors.phone;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Client</CardTitle>
			</CardHeader>
			<CardContent>
				<FieldGroup>
					<div className="flex flex-wrap items-start justify-between gap-2">
						<div className="flex min-w-0 flex-col gap-1">
							{lookup.state === "found" && (
								<span className="font-medium break-words">
									{lookup.client.name}
								</span>
							)}
							<span className="text-sm text-muted-foreground">
								{lookup.phone}
							</span>
						</div>
						{lookup.state === "found" ? (
							<Badge variant="secondary">Returning client</Badge>
						) : (
							<Badge variant="outline">New client</Badge>
						)}
					</div>
					{problem && <FieldError id="client-error">{problem}</FieldError>}
					{lookup.state === "found" ? (
						<>
							<input type="hidden" name="clientId" value={lookup.client.id} />
							<p className="text-sm text-muted-foreground">
								Their saved name, email and notes stay as they are.
							</p>
						</>
					) : (
						<>
							<input type="hidden" name="phone" value={lookup.phone} />
							<Field data-invalid={!!errors.name}>
								<FieldLabel htmlFor="name">Name</FieldLabel>
								<Input
									id="name"
									name="name"
									maxLength={120}
									required
									aria-invalid={!!errors.name}
									aria-describedby={errorId("name", errors)}
									className={TARGET}
								/>
								{errors.name && (
									<FieldError id="name-error">{errors.name}</FieldError>
								)}
							</Field>
							<Field data-invalid={!!errors.email}>
								<FieldLabel htmlFor="email">Email (optional)</FieldLabel>
								<Input
									id="email"
									name="email"
									type="email"
									maxLength={254}
									aria-invalid={!!errors.email}
									aria-describedby={errorId("email", errors)}
									className={TARGET}
								/>
								{errors.email && (
									<FieldError id="email-error">{errors.email}</FieldError>
								)}
							</Field>
						</>
					)}
					<div className="flex flex-wrap gap-2">
						<Link
							href={`${urlFor("tenant.projects.create", { tenant: tenant.slug })}${date ? `?date=${date}` : ""}`}
							aria-describedby={problem ? "client-error" : undefined}
							className={buttonVariants({
								variant: "outline",
								className: TARGET,
							})}
						>
							Change number
						</Link>
						{isOwner && lookup.state === "found" && (
							<Link
								route="tenant.clients.show"
								routeParams={{ tenant: tenant.slug, id: lookup.client.id }}
								className={buttonVariants({
									variant: "outline",
									className: TARGET,
								})}
							>
								View client
							</Link>
						)}
					</div>
				</FieldGroup>
			</CardContent>
		</Card>
	);
}

function SessionCard({
	artists,
	isOwner,
	dates,
	errors,
}: {
	artists: BookingPageProps["artists"];
	isOwner: boolean;
	dates: BookingPageProps["dates"];
	errors: Errors;
}) {
	// An artist member only ever gets their own profile.
	const own = isOwner ? null : artists[0];

	return (
		<Card>
			<CardHeader>
				<CardTitle>Session</CardTitle>
			</CardHeader>
			<CardContent>
				<FieldGroup>
					{own ? (
						<Field
							data-invalid={!!errors.artistId}
							aria-labelledby="artist-title"
							aria-describedby={errorId("artistId", errors)}
						>
							<FieldTitle id="artist-title">Artist</FieldTitle>
							<p className="text-sm">{own.name} (you)</p>
							<input type="hidden" name="artistId" value={own.id} />
							{errors.artistId && (
								<FieldError id="artistId-error">{errors.artistId}</FieldError>
							)}
						</Field>
					) : (
						<Field data-invalid={!!errors.artistId}>
							<FieldLabel htmlFor="artistId">Artist</FieldLabel>
							<select
								id="artistId"
								name="artistId"
								required
								defaultValue={artists.length === 1 ? artists[0].id : ""}
								aria-invalid={!!errors.artistId}
								aria-describedby={errorId("artistId", errors)}
								className={cn(
									"w-full min-w-0 rounded-md border bg-transparent px-3 text-sm",
									TARGET,
								)}
							>
								{artists.length > 1 && (
									<option value="" disabled>
										Choose an artist
									</option>
								)}
								{artists.map(({ id, name }) => (
									<option key={id} value={id}>
										{name}
									</option>
								))}
							</select>
							{errors.artistId && (
								<FieldError id="artistId-error">{errors.artistId}</FieldError>
							)}
						</Field>
					)}
					<div className="grid gap-4 sm:grid-cols-3">
						<Field data-invalid={!!errors.date}>
							<FieldLabel htmlFor="date">Date</FieldLabel>
							<Input
								id="date"
								name="date"
								type="date"
								required
								min={dates.today}
								max={dates.max}
								defaultValue={dates.initial}
								aria-invalid={!!errors.date}
								aria-describedby={errorId("date", errors)}
								className={TARGET}
							/>
							{errors.date && (
								<FieldError id="date-error">{errors.date}</FieldError>
							)}
						</Field>
						<Field data-invalid={!!errors.startTime}>
							<FieldLabel htmlFor="startTime">Start time</FieldLabel>
							<Input
								id="startTime"
								name="startTime"
								type="time"
								required
								aria-invalid={!!errors.startTime}
								aria-describedby={errorId("startTime", errors)}
								className={TARGET}
							/>
							{errors.startTime && (
								<FieldError id="startTime-error">{errors.startTime}</FieldError>
							)}
						</Field>
						<Field data-invalid={!!errors.hours}>
							<FieldLabel htmlFor="hours">Length (hours)</FieldLabel>
							<Input
								id="hours"
								name="hours"
								type="number"
								inputMode="decimal"
								required
								min={0.25}
								max={12}
								step={0.25}
								aria-invalid={!!errors.hours}
								aria-describedby={errors.hours ? "hours-error" : "hours-hint"}
								className={TARGET}
							/>
							{errors.hours ? (
								<FieldError id="hours-error">{errors.hours}</FieldError>
							) : (
								<FieldDescription id="hours-hint">
									In quarter hours: 2.5 for two and a half.
								</FieldDescription>
							)}
						</Field>
					</div>
					<Field data-invalid={!!errors.brief}>
						<FieldLabel htmlFor="brief">What&apos;s the tattoo?</FieldLabel>
						<Textarea
							id="brief"
							name="brief"
							rows={3}
							maxLength={4000}
							required
							aria-invalid={!!errors.brief}
							aria-describedby={errors.brief ? "brief-error" : "brief-hint"}
						/>
						{errors.brief ? (
							<FieldError id="brief-error">{errors.brief}</FieldError>
						) : (
							<FieldDescription id="brief-hint">
								A few words for the project page, like small rose on the left
								wrist.
							</FieldDescription>
						)}
					</Field>
				</FieldGroup>
			</CardContent>
		</Card>
	);
}

function PriceCard({
	priceKind,
	onChange,
	errors,
}: {
	priceKind: PriceKind;
	onChange: (kind: PriceKind) => void;
	errors: Errors;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Price (optional)</CardTitle>
			</CardHeader>
			<CardContent>
				<FieldGroup>
					<FieldSet data-invalid={!!errors.priceKind}>
						<FieldLegend className="sr-only">Pricing</FieldLegend>
						<RadioGroup
							name="priceKind"
							value={priceKind}
							aria-invalid={!!errors.priceKind}
							aria-describedby={errorId("priceKind", errors)}
							onValueChange={(value) =>
								onChange(
									value === "fixed" || value === "hourly" ? value : "none",
								)
							}
						>
							{PRICE_KINDS.map(({ value, title, description }) => (
								<FieldLabel key={value} htmlFor={`priceKind-${value}`}>
									<Field orientation="horizontal">
										<FieldContent>
											<FieldTitle>{title}</FieldTitle>
											<FieldDescription>{description}</FieldDescription>
										</FieldContent>
										<RadioGroupItem value={value} id={`priceKind-${value}`} />
									</Field>
								</FieldLabel>
							))}
						</RadioGroup>
						{errors.priceKind && (
							<FieldError id="priceKind-error">{errors.priceKind}</FieldError>
						)}
					</FieldSet>

					{priceKind === "fixed" && (
						<Field data-invalid={!!errors.fixedPrice}>
							<FieldLabel htmlFor="fixedPrice">Price (NPR)</FieldLabel>
							<Input
								id="fixedPrice"
								name="fixedPrice"
								type="number"
								inputMode="numeric"
								required
								min={1}
								step={1}
								aria-invalid={!!errors.fixedPrice}
								aria-describedby={errorId("fixedPrice", errors)}
								className={TARGET}
							/>
							{errors.fixedPrice && (
								<FieldError id="fixedPrice-error">
									{errors.fixedPrice}
								</FieldError>
							)}
						</Field>
					)}
					{priceKind === "hourly" && (
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
									required
									min={1}
									step={1}
									aria-invalid={!!errors.hourlyRate}
									aria-describedby={errorId("hourlyRate", errors)}
									className={TARGET}
								/>
								{errors.hourlyRate && (
									<FieldError id="hourlyRate-error">
										{errors.hourlyRate}
									</FieldError>
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
									required
									min={0.25}
									step={0.25}
									aria-invalid={!!errors.estimatedHours}
									aria-describedby={errorId("estimatedHours", errors)}
									className={TARGET}
								/>
								{errors.estimatedHours && (
									<FieldError id="estimatedHours-error">
										{errors.estimatedHours}
									</FieldError>
								)}
							</Field>
						</>
					)}

					<FieldDescription>
						No deposit is asked: the client is booked now. The price can&apos;t
						be changed after booking.
					</FieldDescription>
				</FieldGroup>
			</CardContent>
		</Card>
	);
}

BookingNew.layout = [AppLayout];
