import { Link } from "@tanstack/react-router";
import type {
	DiscoverArtistDetail,
	DiscoverStyle,
	DiscoverTattooSummary,
} from "@tattoo-drip/sdk";
import { ArrowUpRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
	Breadcrumbs,
	type Crumb,
	EditorialSection,
	PageContainer,
	SectionHeading,
} from "#/components/discovery/layout";
import {
	type ImageSource,
	ResponsiveImage,
} from "#/components/discovery/responsive-image";
import { ArtworkColumns } from "#/components/gallery/artwork-tile";
import { buttonVariants } from "#/components/ui/button";
import { safeSocialUrl, socialLabel } from "#/lib/booking";
import { paths } from "#/lib/routes";
import { cn } from "#/lib/utils";

/*
 * The profile pages' pieces (D08): one hero, the booking actions, the
 * portfolio, the facts and the related links, shared by the studio, the
 * studio-artist and the independent-artist profiles. Editorial, on the D05
 * tokens; every value comes from the API and renders as plain text.
 */

export { ratioOf } from "#/components/gallery/artwork-tile";

/**
 * The top of a profile: breadcrumbs, then identity (eyebrow, the page's one
 * h1, where), the picture and the booking actions. On a phone they stack in
 * that order (identity, artwork, booking); from `lg` the picture takes the
 * right-hand column beside identity and booking.
 */
export function ProfileHero({
	breadcrumbs,
	eyebrow,
	title,
	badge,
	meta,
	media,
	actions,
}: {
	breadcrumbs: Crumb[];
	eyebrow: ReactNode;
	title: string;
	/** A logo or portrait beside the name; decorative (the name is the h1). */
	badge?: ReactNode;
	meta?: ReactNode;
	media: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<header className="border-b border-line">
			<PageContainer className="pt-6 lg:pt-10">
				<Breadcrumbs items={breadcrumbs} />
			</PageContainer>
			<PageContainer className="grid gap-6 pt-6 pb-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[auto_1fr] lg:gap-x-12 lg:gap-y-8 lg:pt-10 lg:pb-16">
				<div className="flex min-w-0 flex-col gap-4 lg:self-end">
					<p className="eyebrow text-muted-foreground">{eyebrow}</p>
					<div className="flex min-w-0 items-center gap-4">
						{badge}
						<h1 className="min-w-0 font-display text-display-xl font-bold break-words">
							{title}
						</h1>
					</div>
					{meta}
				</div>
				<div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
					{media}
				</div>
				{actions && <div className="min-w-0 lg:self-start">{actions}</div>}
			</PageContainer>
		</header>
	);
}

/**
 * The hero's picture: the image in a fixed frame (no layout shift; a
 * phone gets a 4:5 crop, a wide screen 4:3), loaded first; else the name
 * set in type on night, never a stock image.
 */
export function HeroMedia({
	image,
	alt,
	name,
}: {
	image: ImageSource | null;
	alt: string;
	name: string;
}) {
	if (image)
		return (
			<ResponsiveImage
				image={image}
				alt={alt}
				ratio={null}
				priority
				large
				sizes="(min-width: 64rem) 55vw, 100vw"
				className="aspect-[4/5] sm:aspect-[3/2] lg:aspect-[4/3]"
			/>
		);
	return (
		<div
			aria-hidden="true"
			className="night flex aspect-[3/2] items-end p-6 lg:aspect-[4/3] lg:p-10"
		>
			<span className="font-display text-display-xl leading-none font-bold break-words">
				{name}
			</span>
		</div>
	);
}

export type BookingActionsProps = {
	/** The storefront's request form (src/lib/booking.ts), or null: not available online. */
	request: string | null;
	/** "Request a session", "Request with Maya". */
	requestLabel: string;
	/** The studio's (or artist's) page on its own site, or null. */
	site: string | null;
	siteLabel: string;
	/** Whose site both open, for the note and screen readers: "Black Needle's". */
	owner: string;
	/** An artist who isn't taking requests: what to say instead of the request. */
	closed?: string;
	size?: "md" | "lg";
};

/**
 * The booking hand-off: the request (the storefront takes requests, not
 * instant bookings, so the words say request) and the studio's own site.
 * Both leave Discover for the studio's site, and say so to screen readers.
 * Without a safe destination the page says booking isn't available online
 * here: never a guessed link.
 */
export function BookingActions({
	request,
	requestLabel,
	site,
	siteLabel,
	owner,
	closed,
	size = "lg",
}: BookingActionsProps) {
	return (
		<div className="flex flex-col gap-3">
			{closed && <p className="font-medium">{closed}</p>}
			<div className="flex flex-wrap gap-3">
				{request && (
					<a
						href={request}
						className={buttonVariants({ variant: "accent", size })}
					>
						{requestLabel}
						<ArrowUpRightIcon aria-hidden="true" />
						<span className="sr-only">{`(${owner} own booking form)`}</span>
					</a>
				)}
				{site && (
					<a
						href={site}
						className={buttonVariants({ variant: "outline", size })}
					>
						{siteLabel}
						<ArrowUpRightIcon aria-hidden="true" />
						<span className="sr-only">{`(${owner} own site)`}</span>
					</a>
				)}
			</div>
			<p className="max-w-md text-sm text-muted-foreground">
				{request
					? `Opens ${owner} own booking form. It's a request, not an instant booking: they reply to agree a date and price.`
					: "Booking isn't available online from Discover right now."}
			</p>
		</div>
	);
}

/**
 * A phone's booking bar: sticky at the bottom of the profile (below `lg`),
 * it rests at the end of the page above the footer, so it never covers the
 * last content or the footer; the page's scroll padding (styles.css) keeps
 * a focused control clear of it. It comes last in the tab order.
 */
export function StickyBooking({
	name,
	request,
	label,
	owner,
}: {
	name: string;
	request: string;
	label: string;
	/** Whose booking form it opens: "Black Needle's", "their". */
	owner: string;
}) {
	return (
		<aside
			aria-label={`Request a session with ${name}`}
			data-booking-bar=""
			className="sticky bottom-0 z-30 border-t border-line bg-paper lg:hidden"
		>
			<div className="page-gutter flex items-center justify-between gap-3 py-3">
				<span className="min-w-0 truncate text-sm font-medium">{name}</span>
				<a
					href={request}
					className={buttonVariants({ variant: "accent", size: "md" })}
				>
					{label}
					<span className="sr-only">{`(${owner} own booking form)`}</span>
				</a>
			</div>
		</aside>
	);
}

/**
 * A portfolio preview: the newest published photos in columns at their true
 * proportions (lazy, fixed frames), each opening its artwork page (D09),
 * with its caption (which may link the artist's profile beside it). A night
 * band, as the other work sections; `more` links to all of the work in the
 * gallery.
 */
export function Portfolio({
	id,
	eyebrow,
	title,
	intro,
	tattoos,
	caption,
	more,
}: {
	id: string;
	eyebrow: string;
	title: string;
	intro?: ReactNode;
	tattoos: readonly DiscoverTattooSummary[];
	caption: (tattoo: DiscoverTattooSummary) => ReactNode;
	more?: ReactNode;
}) {
	return (
		<EditorialSection tone="night" labelledBy={id} className="lg:py-20">
			<div className="mb-8 flex flex-col gap-4 lg:mb-12 lg:flex-row lg:items-end lg:justify-between">
				<SectionHeading id={id} eyebrow={eyebrow} title={title} intro={intro} />
				{more}
			</div>
			<ArtworkColumns
				tattoos={tattoos}
				caption={caption}
				columns="lg:columns-3"
				sizes="(min-width: 40rem) 33vw, 50vw"
			/>
		</EditorialSection>
	);
}

/** A photo's own words: its styles and whether it is healed ("Fine line · Healed"), else "Tattoo". */
export function workCaption(tattoo: DiscoverTattooSummary): string {
	const parts = tattoo.styles.map((style) => style.name);
	if (tattoo.healed) parts.push("Healed");
	return parts.join(" · ") || "Tattoo";
}

/** The styles a profile names, each to its style page (D07). */
export function StyleLinks({
	styles,
	label = "Styles",
}: {
	styles: readonly DiscoverStyle[];
	label?: string;
}) {
	return (
		<ul aria-label={label} className="flex flex-wrap gap-2">
			{styles.map((style) => (
				<li key={style.slug}>
					<Link
						to={paths.style(style.slug)}
						className="inline-flex min-h-11 items-center rounded-[2px] border border-line-strong px-3 text-sm hover:border-ink lg:min-h-9"
					>
						{style.name}
					</Link>
				</li>
			))}
		</ul>
	);
}

/** Public social and website links (https only); none renders nothing. */
export function SocialLinks({
	links,
	owner,
}: {
	links: DiscoverArtistDetail["socialLinks"];
	owner: string;
}) {
	const safe = links.flatMap((link) => {
		const url = safeSocialUrl(link.url);
		return url ? [{ ...link, url }] : [];
	});
	if (safe.length === 0) return null;
	return (
		<ul className="flex flex-wrap gap-x-6 gap-y-1">
			{safe.map((link) => (
				<li key={`${link.platform}:${link.url}`}>
					<a
						href={link.url}
						rel="noopener noreferrer"
						className="inline-flex min-h-11 items-center gap-1.5 underline-offset-4 hover:underline lg:min-h-0"
					>
						{socialLabel(link.platform)}
						<ArrowUpRightIcon className="size-4" aria-hidden="true" />
						<span className="sr-only">{`(${owner} page, another site)`}</span>
					</a>
				</li>
			))}
		</ul>
	);
}

/** A labelled list of facts; a fact with no value is left out, and an empty list renders nothing. */
export function Facts({
	items,
}: {
	items: { term: string; value: ReactNode | null | false }[];
}) {
	const shown = items.filter((item) => item.value);
	if (shown.length === 0) return null;
	return (
		<dl className="flex flex-col border-t border-ink">
			{shown.map((item) => (
				<div
					key={item.term}
					className="grid gap-2 border-b border-line py-4 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-6"
				>
					<dt className="eyebrow pt-1 text-muted-foreground">{item.term}</dt>
					<dd className="min-w-0">{item.value}</dd>
				</div>
			))}
		</dl>
	);
}

/** Plain text from the API, its paragraphs kept (never HTML). */
export function PlainText({
	text,
	className,
}: {
	text: string;
	className?: string;
}) {
	return (
		<div className={cn("flex max-w-prose flex-col gap-4 text-lg", className)}>
			{text
				.split(/\n\s*\n/)
				.map((paragraph) => paragraph.trim())
				.filter(Boolean)
				.map((paragraph, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: paragraphs of one fixed text.
					<p key={index} className="whitespace-pre-line">
						{paragraph}
					</p>
				))}
		</div>
	);
}

/** The page's closing links on to the rest of Discover. */
export function RelatedLinks({
	id,
	title,
	links,
}: {
	id: string;
	title: string;
	links: {
		key: string;
		to: string;
		search?: Record<string, string>;
		text: string;
	}[];
}) {
	return (
		<section
			aria-labelledby={id}
			className="border-t border-line py-12 lg:py-16"
		>
			<PageContainer className="flex flex-col gap-6">
				<h2 id={id} className="font-display text-display-md font-bold">
					{title}
				</h2>
				<ul className="flex flex-col border-t border-ink sm:flex-row sm:flex-wrap sm:gap-x-10 sm:border-t-0">
					{links.map((link) => (
						<li key={link.key} className="border-b border-line sm:border-b-0">
							<Link
								to={link.to}
								search={link.search as never}
								className="inline-flex min-h-12 items-center font-medium underline-offset-4 hover:underline"
							>
								{link.text}
							</Link>
						</li>
					))}
				</ul>
			</PageContainer>
		</section>
	);
}
