import { Form, Link } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { cn } from "cn";
import { Circle, CircleAlert, CircleCheck, Eye } from "lucide-react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { urlFor } from "~/client";
import {
	ARTISTS_HEADING,
	ARTISTS_INTRO,
	acceptedLine,
	actionLabel,
	type BusinessType,
	blockedLine,
	CHECKLIST_HEADING,
	CITY_HEADING,
	CITY_INTRO,
	CITY_LABEL,
	CITY_LISTED_NOTE,
	CITY_PLACEHOLDER,
	CONSENT_CANCEL,
	CONSENT_LABEL,
	CONSENT_TERMS_HEADING,
	checklistFigure,
	checklistIntro,
	cityClear,
	citySave,
	consentShowsHeading,
	consentSubmit,
	type DiscoverStatus,
	DRAFT_MARKER,
	DRAFT_NOTE,
	LISTING_HEADING,
	LISTING_OFF,
	LISTING_ON,
	listLabel,
	manageLabel,
	metWords,
	NO_ARTISTS,
	NO_PLACES,
	offLine,
	onLine,
	optionalNote,
	PAGE_TITLE,
	PORTFOLIO_LINK,
	pageIntro,
	photosFigure,
	previewLabel,
	requirementLabel,
	samePageHash,
	statusTone,
	TAKEN_DOWN_HEADING,
	TAKEN_DOWN_NOTE,
	TONE_CLASS,
	TURN_OFF_BUSY,
	TURN_OFF_KEEP,
	TURN_OFF_LABEL,
	turnOffQuestion,
} from "~/components/discover";
import InlineConfirm from "~/components/inline_confirm";
import type { NavParams, NavRoute } from "~/components/nav_link";
import Section from "~/components/section";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

type Status = { key: DiscoverStatus; label: string; summary: string };
type Listing = {
	optedIn: boolean;
	takenDown: boolean;
	publiclyVisible: boolean;
	canEnable: boolean;
};
type Consent = {
	version: string;
	draft: boolean;
	text: string;
	shows: string[];
	accepted: { version: string; acceptedOn: string; current: boolean } | null;
};
type Place = { id: string; label: string };
type Target = { route: string; params: Record<string, string>; hash?: string };
type ReadinessItem = {
	key: string;
	required: boolean;
	met: boolean;
	label: string;
	detail: string;
	current: number | null;
	recommended: number | null;
	action: string;
	target: Target;
};
type Readiness = {
	eligible: boolean;
	complete: boolean;
	items: ReadinessItem[];
};
type ArtistRow = {
	id: string;
	name: string;
	visible: boolean;
	discoveryListed: boolean;
	publishedPhotos: number;
	state: string;
	stateText: string;
};

type FieldErrors = Partial<Record<string, string>>;

const THIS_ROUTE = "tenant.settings.discover";
const CHECKLIST_LINK_CLASS =
	"inline-flex items-center self-start text-sm underline underline-offset-4 max-lg:min-h-11";

/** A checklist link that names its target exactly as the server gave it. */
function targetHref(target: Target): string {
	const here = samePageHash(target, THIS_ROUTE);
	if (here) return here;
	const url = urlFor(target.route as NavRoute, target.params as NavParams);
	return target.hash ? `${url}#${target.hash}` : url;
}

/**
 * Settings, Discover (Discover D04): the owner's listing on TattooDrip
 * Discover, its city, the readiness checklist and the artists' Discover
 * state. Optional and off by default, and separate from the studio page.
 * Nothing here shows a result early. Every write redirects back and the page
 * re-renders from the database, so the badge and the switch only ever show
 * what the server says.
 */
export default function DiscoverSettings({
	business,
	status,
	listing,
	consent,
	place,
	places,
	readiness,
	artists,
	recommended,
}: {
	business: { type: BusinessType; name: string };
	status: Status;
	listing: Listing;
	consent: Consent;
	place: Place | null;
	places: Place[];
	readiness: Readiness;
	artists: ArtistRow[];
	recommended: { studioPhotos: number; artistPhotos: number };
}) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug };
	const type = business.type;
	const heading = useRef<HTMLHeadingElement>(null);
	const tone = statusTone(status.key);

	// The listing's answer changes the section under the focused button:
	// focus goes to the heading, so a keyboard user doesn't land on <body>.
	const optedIn = useRef(listing.optedIn);
	useEffect(() => {
		if (optedIn.current === listing.optedIn) return;
		optedIn.current = listing.optedIn;
		heading.current?.focus();
	}, [listing.optedIn]);

	return (
		<div className="flex flex-col gap-8">
			<header className="flex flex-col gap-3">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex min-w-0 flex-col gap-1">
						<h2
							ref={heading}
							tabIndex={-1}
							className="text-lg leading-snug font-semibold outline-none"
						>
							{PAGE_TITLE}
						</h2>
						<p className="text-sm text-muted-foreground">{pageIntro(type)}</p>
					</div>
					<Link
						route="tenant.settings.discover.preview"
						routeParams={params}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						<Eye aria-hidden="true" />
						{previewLabel(type)}
					</Link>
				</div>
				<div className="flex flex-col items-start gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:gap-3">
					<Badge
						variant={tone === "danger" ? "destructive" : "ghost"}
						data-status={status.key}
						className={cn(
							"px-2.5 py-1 text-sm",
							tone !== "danger" && [
								"ring-1 ring-current/20 ring-inset",
								TONE_CLASS[tone],
							],
						)}
					>
						{status.label}
					</Badge>
					{/* After a write the page re-renders: the new summary is announced. */}
					<output className="text-sm">{status.summary}</output>
				</div>
			</header>

			<div className="@container">
				<div className="grid grid-cols-1 gap-8 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] @4xl:items-start">
					<div className="flex min-w-0 flex-col">
						<ListingSection
							// A new answer starts the section afresh (the consent panel closed).
							key={String(listing.optedIn)}
							type={type}
							status={status}
							listing={listing}
							consent={consent}
							readiness={readiness}
							fallback={heading}
						/>
						<CitySection
							optedIn={listing.optedIn}
							place={place}
							places={places}
						/>
					</div>
					<div className="flex min-w-0 flex-col">
						<Checklist type={type} readiness={readiness} />
						{type === "studio" ? (
							<ArtistsOverview
								artists={artists}
								recommendedPhotos={recommended.artistPhotos}
							/>
						) : (
							<Section>
								<Link
									route="tenant.portfolio"
									routeParams={params}
									className={cn(
										buttonVariants({ variant: "outline", size: "sm" }),
										"self-start",
									)}
								>
									{PORTFOLIO_LINK}
								</Link>
							</Section>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function ListingSection({
	type,
	status,
	listing,
	consent,
	readiness,
	fallback,
}: {
	type: BusinessType;
	status: Status;
	listing: Listing;
	consent: Consent;
	readiness: Readiness;
	fallback: RefObject<HTMLElement | null>;
}) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug };
	const panelId = useId();
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const panelHeading = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		if (open) panelHeading.current?.focus();
	}, [open]);
	const close = () => {
		setOpen(false);
		setTimeout(() => trigger.current?.focus(), 0);
	};
	const blocking = readiness.items
		.filter((item) => item.required && !item.met)
		.map((item) => item.label);

	return (
		<Section title={LISTING_HEADING} description={optionalNote(type)}>
			<div className="flex flex-col gap-4">
				{listing.takenDown && (
					<div
						role="note"
						className="flex gap-3 rounded-md border border-destructive/40 p-3 text-sm"
					>
						<CircleAlert
							aria-hidden="true"
							className="mt-0.5 size-4 shrink-0 text-destructive"
						/>
						<div className="flex flex-col gap-1">
							<p className="font-medium">{TAKEN_DOWN_HEADING}</p>
							<p>{status.summary}</p>
							<p className="text-muted-foreground">{TAKEN_DOWN_NOTE}</p>
						</div>
					</div>
				)}

				{listing.optedIn ? (
					<div className="flex flex-col gap-3">
						<p className="flex items-center gap-2 text-sm">
							<Badge
								variant="ghost"
								className={cn(
									"ring-1 ring-current/20 ring-inset",
									TONE_CLASS.success,
								)}
							>
								{LISTING_ON}
							</Badge>
							{onLine(type)}
						</p>
						{consent.accepted && (
							<p className="text-sm text-muted-foreground">
								{acceptedLine(consent.accepted)}
							</p>
						)}
						<InlineConfirm
							label={TURN_OFF_LABEL}
							question={turnOffQuestion(type)}
							confirmLabel={TURN_OFF_LABEL}
							keepLabel={TURN_OFF_KEEP}
							busyLabel={TURN_OFF_BUSY}
							fallback={fallback}
							onConfirm={(finished) =>
								router.delete(
									urlFor("tenant.settings.discover.listing.destroy", params),
									{ preserveScroll: true, onFinish: finished },
								)
							}
						/>
					</div>
				) : (
					<div className="flex flex-col gap-3">
						<p className="flex items-center gap-2 text-sm">
							<Badge
								variant="ghost"
								className={cn(
									"ring-1 ring-current/20 ring-inset",
									TONE_CLASS.neutral,
								)}
							>
								{LISTING_OFF}
							</Badge>
							<span className="text-muted-foreground">{offLine(type)}</span>
						</p>
						<div>
							<Button
								ref={trigger}
								type="button"
								disabled={!listing.canEnable}
								aria-expanded={open}
								aria-controls={panelId}
								aria-describedby={
									listing.canEnable ? undefined : `${panelId}-blocked`
								}
								onClick={() => setOpen(true)}
								className="h-auto text-left whitespace-normal"
							>
								{listLabel(type)}
							</Button>
						</div>
						{!listing.canEnable && (
							<p
								id={`${panelId}-blocked`}
								className="text-sm text-muted-foreground"
							>
								{blockedLine(blocking)}
							</p>
						)}
						{open && listing.canEnable && (
							<section
								id={panelId}
								aria-labelledby={`${panelId}-heading`}
								className="flex flex-col gap-4 rounded-md border p-4"
								onKeyDown={(event) => {
									if (event.key === "Escape") close();
								}}
							>
								<div className="flex flex-col gap-2">
									<h3
										ref={panelHeading}
										id={`${panelId}-heading`}
										tabIndex={-1}
										className="text-sm font-semibold outline-none"
									>
										{consentShowsHeading(type)}
									</h3>
									<ul className="ml-4 list-disc text-sm marker:text-muted-foreground">
										{consent.shows.map((line) => (
											<li key={line}>{line}</li>
										))}
									</ul>
								</div>
								<div className="flex flex-col gap-2">
									<div className="flex flex-wrap items-center gap-2">
										<h3 className="text-sm font-semibold">
											{CONSENT_TERMS_HEADING}
										</h3>
										{consent.draft && (
											<Badge
												variant="ghost"
												className={cn(
													"ring-1 ring-current/20 ring-inset",
													TONE_CLASS.warning,
												)}
											>
												{DRAFT_MARKER}
											</Badge>
										)}
									</div>
									<p className="text-sm">{consent.text}</p>
									{consent.draft && (
										<p className="text-xs text-muted-foreground">
											{DRAFT_NOTE}
										</p>
									)}
								</div>
								<Form
									route="tenant.settings.discover.listing.store"
									routeParams={params}
									options={{ preserveScroll: true }}
								>
									{({ errors, processing }) => (
										<FieldGroup>
											<input
												type="hidden"
												name="consentVersion"
												value={consent.version}
											/>
											<Field
												orientation="horizontal"
												className="min-h-11 items-center"
												data-invalid={!!errors.consent}
											>
												<Checkbox
													id="consent"
													name="consent"
													aria-invalid={!!errors.consent}
													aria-describedby={
														errors.consent ? "consent-error" : undefined
													}
												/>
												<FieldLabel htmlFor="consent">
													{CONSENT_LABEL}
												</FieldLabel>
											</Field>
											{errors.consent && (
												<FieldError id="consent-error">
													{errors.consent}
												</FieldError>
											)}
											{errors.consentVersion && (
												<FieldError>{errors.consentVersion}</FieldError>
											)}
											{/* Not a field of this form: the server refuses a listing without a city on it. */}
											{(errors as FieldErrors).placeId && (
												<FieldError>
													{(errors as FieldErrors).placeId}
												</FieldError>
											)}
											<div className="flex flex-wrap gap-2">
												<Button type="submit" disabled={processing}>
													{consentSubmit(processing)}
												</Button>
												<Button
													type="button"
													variant="ghost"
													disabled={processing}
													onClick={close}
												>
													{CONSENT_CANCEL}
												</Button>
											</div>
										</FieldGroup>
									)}
								</Form>
							</section>
						)}
					</div>
				)}
			</div>
		</Section>
	);
}

/**
 * The city Discover lists the business under. "Remove city" submits the
 * same form with `placeId: null` (the transform), so a refusal (the server
 * keeps a listed business's city) shows under the field like any other.
 */
function CitySection({
	optedIn,
	place,
	places,
}: {
	optedIn: boolean;
	place: Place | null;
	places: Place[];
}) {
	const tenant = useTenant();
	const clearing = useRef(false);
	const [clearSent, setClearSent] = useState(false);

	return (
		<Section id="city" title={CITY_HEADING} description={CITY_INTRO}>
			{places.length === 0 ? (
				<p className="text-sm text-muted-foreground">{NO_PLACES}</p>
			) : (
				<Form
					// A save remounts it on the stored city; a refusal keeps the pick.
					key={place?.id ?? "none"}
					route="tenant.settings.discover.place.update"
					routeParams={{ tenant: tenant.slug }}
					options={{ preserveScroll: true }}
					transform={(data) => (clearing.current ? { placeId: null } : data)}
					onFinish={() => {
						clearing.current = false;
						setClearSent(false);
					}}
					// A save remounts the form (its key is the stored city): give
					// focus back to the picker instead of leaving it on <body>.
					onSuccess={() =>
						setTimeout(() => document.getElementById("placeId")?.focus(), 0)
					}
				>
					{({ errors, processing }) => (
						<FieldGroup>
							<Field data-invalid={!!errors.placeId} className="min-w-0">
								<FieldLabel htmlFor="placeId">{CITY_LABEL}</FieldLabel>
								<Select name="placeId" defaultValue={place?.id} required>
									<SelectTrigger
										id="placeId"
										className="w-full"
										aria-invalid={!!errors.placeId}
										aria-describedby={
											errors.placeId ? "placeId-error" : undefined
										}
									>
										<SelectValue placeholder={CITY_PLACEHOLDER} />
									</SelectTrigger>
									<SelectContent>
										{places.map((option) => (
											<SelectItem key={option.id} value={option.id}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{place && optedIn && (
									<FieldDescription>{CITY_LISTED_NOTE}</FieldDescription>
								)}
								{errors.placeId && (
									<FieldError id="placeId-error">{errors.placeId}</FieldError>
								)}
							</Field>
							<div className="flex flex-wrap gap-2">
								<Button type="submit" disabled={processing}>
									{citySave(processing, clearSent)}
								</Button>
								{place && (
									<Button
										type="submit"
										variant="ghost"
										formNoValidate
										disabled={processing}
										onClick={() => {
											clearing.current = true;
											setClearSent(true);
										}}
									>
										{cityClear(processing, clearSent)}
									</Button>
								)}
							</div>
						</FieldGroup>
					)}
				</Form>
			)}
		</Section>
	);
}

function Checklist({
	type,
	readiness,
}: {
	type: BusinessType;
	readiness: Readiness;
}) {
	return (
		<Section title={CHECKLIST_HEADING} description={checklistIntro(type)}>
			<ul className="divide-y rounded-md border">
				{readiness.items.map((item) => {
					const figure = checklistFigure(item.current, item.recommended);
					const Mark = item.met
						? CircleCheck
						: item.required
							? CircleAlert
							: Circle;
					return (
						<li key={item.key} className="flex gap-3 p-3">
							<Mark
								aria-hidden="true"
								className={cn(
									"mt-0.5 size-4 shrink-0",
									item.met
										? "text-status-booked-fg"
										: item.required
											? "text-destructive"
											: "text-muted-foreground",
								)}
							/>
							<div className="flex min-w-0 flex-1 flex-col gap-1">
								<p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
									<span className="sr-only">{metWords(item.met)}</span>
									<span className="font-medium">{item.label}</span>
									<span
										className={cn(
											"text-xs",
											item.required && !item.met
												? "font-medium text-destructive"
												: "text-muted-foreground",
										)}
									>
										{requirementLabel(item.required)}
									</span>
									{figure && (
										<span className="text-xs text-muted-foreground tabular-nums">
											{figure}
										</span>
									)}
								</p>
								<p className="text-sm text-muted-foreground">{item.detail}</p>
								{samePageHash(item.target, THIS_ROUTE) ? (
									<a
										href={targetHref(item.target)}
										className={CHECKLIST_LINK_CLASS}
									>
										{actionLabel(item.action, type, item.met)}
									</a>
								) : (
									<Link
										href={targetHref(item.target)}
										className={CHECKLIST_LINK_CLASS}
									>
										{actionLabel(item.action, type, item.met)}
									</Link>
								)}
							</div>
						</li>
					);
				})}
			</ul>
		</Section>
	);
}

function ArtistsOverview({
	artists,
	recommendedPhotos,
}: {
	artists: ArtistRow[];
	recommendedPhotos: number;
}) {
	const tenant = useTenant();
	return (
		<Section title={ARTISTS_HEADING} description={ARTISTS_INTRO}>
			{artists.length === 0 ? (
				<p className="text-sm text-muted-foreground">{NO_ARTISTS}</p>
			) : (
				<ul className="divide-y rounded-md border">
					{artists.map((artist) => (
						<li
							key={artist.id}
							className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3"
						>
							<div className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span className="text-sm font-medium wrap-anywhere" dir="auto">
									{artist.name}
								</span>
								<span className="text-sm text-muted-foreground">
									{artist.stateText}
								</span>
								<span className="text-xs text-muted-foreground tabular-nums">
									{photosFigure(artist.publishedPhotos, recommendedPhotos)}
								</span>
							</div>
							<Link
								href={`${urlFor("tenant.artists.edit", { tenant: tenant.slug, id: artist.id })}#discover`}
								aria-label={manageLabel(artist.name)}
								className={buttonVariants({ variant: "ghost", size: "sm" })}
							>
								Manage
							</Link>
						</li>
					))}
				</ul>
			)}
		</Section>
	);
}

DiscoverSettings.layout = [AppLayout, SettingsLayout];
