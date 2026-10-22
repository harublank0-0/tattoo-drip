import { useLocation } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { studioCopy } from "../copy.ts";
import { isAllowedHref, linkRel } from "../links.ts";
import type { ArtistPageData, StudioPageData } from "../loaders.ts";
import type { SectionKey } from "../theme/config.ts";
import { ArtistProfile, ArtistRoster } from "./artists.tsx";
import { BrandCover, BrandLogo } from "./brand.tsx";
import { ContactBlock } from "./contact.tsx";
import { InquirySection } from "./inquiry.tsx";
import { BookingStrip } from "./steps.tsx";

/**
 * The studio page's two pages and its status pages (TAT-48). Props only and
 * plain anchors: no router or query hooks (except RouteErrorPage, the
 * router's glue), so test/studio/render.test.ts renders them on their own.
 */

export function StudioPage({
	data,
	challengeSiteKey = null,
}: {
	data: StudioPageData;
	/** The intake form's public Turnstile site key (TAT-57). */
	challengeSiteKey?: string | null;
}) {
	const { studio, theme } = data;
	// The hero's WhatsApp button is the plain chat link the Chat group lists.
	const whatsapp = studio.links.find(
		(link) => link.kind === "whatsapp" && isAllowedHref(link.href),
	);
	return (
		<>
			<main className="page">
				{theme.heroImage ? <BrandCover image={theme.heroImage} /> : null}
				<header className="profile">
					<div className="profile-heading">
						{theme.logo ? (
							<BrandLogo image={theme.logo} className="profile-logo" />
						) : null}
						<h1 className="profile-name" dir="auto">
							{studio.name}
						</h1>
						<p className="profile-location user-text" dir="auto">
							{studio.location ?? studio.typeLabel}
						</p>
					</div>
					<div className="profile-actions">
						{studio.accepting ? (
							<div className="actions">
								<a className="action action-primary" href="#inquiry">
									{studioCopy.sendIdea}
								</a>
								{whatsapp ? (
									<a
										className="action action-secondary"
										href={whatsapp.href}
										rel={linkRel(whatsapp.href)}
									>
										<MessageCircle aria-hidden="true" />
										<span>{studioCopy.whatsapp}</span>
									</a>
								) : null}
							</div>
						) : (
							<p className="status status-closed">{studioCopy.notTaking}</p>
						)}
					</div>
					{studio.accepting ? <BookingStrip studioName={studio.name} /> : null}
					{studio.intro ? (
						<p className="profile-intro user-text measure" dir="auto">
							{studio.intro}
						</p>
					) : null}
					<ContactBlock studio={studio} />
				</header>
				{theme.sections.map((section) => (
					<StudioSection
						key={section}
						section={section}
						data={data}
						challengeSiteKey={challengeSiteKey}
					/>
				))}
			</main>
			<SiteFooter studioName={studio.name} />
		</>
	);
}

/**
 * One of the studio page's sections, in the order the theme's config gives
 * (TAT-54). The inquiry section is always one of them (readSections).
 */
function StudioSection({
	section,
	data,
	challengeSiteKey,
}: {
	section: SectionKey;
	data: StudioPageData;
	challengeSiteKey: string | null;
}) {
	switch (section) {
		case "artists":
			return <ArtistRoster artists={data.artists} />;
		case "inquiry":
			return (
				<InquirySection
					state={data.inquiry}
					channels={data.channels}
					challengeSiteKey={challengeSiteKey}
				/>
			);
	}
}

export function ArtistPage({
	data,
	challengeSiteKey = null,
}: {
	data: ArtistPageData;
	/** The intake form's public Turnstile site key (TAT-57). */
	challengeSiteKey?: string | null;
}) {
	const { studio, artist, inquiry, channels, theme } = data;
	return (
		<>
			<header className="site-bar">
				<a href="/" dir="auto">
					{theme.logo ? (
						<>
							<BrandLogo image={theme.logo} className="site-bar-logo" />
							<span>{studio.name}</span>
						</>
					) : (
						studio.name
					)}
				</a>
			</header>
			<main className="page">
				<ArtistProfile artist={artist} studio={studio} />
				<InquirySection
					state={inquiry}
					channels={channels}
					challengeSiteKey={challengeSiteKey}
					stripAbove
				/>
				<section className="section" aria-labelledby="studio-title">
					<h2 id="studio-title" className="section-title" dir="auto">
						{studio.name}
					</h2>
					<div className="stack">
						<p className="profile-type">{studio.typeLabel}</p>
						<ContactBlock studio={studio} />
						<a className="text-link" href="/">
							See the studio page
						</a>
					</div>
				</section>
			</main>
			<SiteFooter studioName={studio.name} />
		</>
	);
}

/** Who runs the page clients' details go through (no link until a marketing site exists). */
export function SiteFooter({ studioName }: { studioName: string }) {
	return (
		<footer className="site-footer">
			<p dir="auto">{studioName}</p>
			<p>Studio page by Tattoo Drip</p>
		</footer>
	);
}

/** The router's not-found page: an unknown path, or a hidden or unknown artist. */
export function NotFoundPage() {
	return (
		<main className="page status-page">
			<h1 className="section-title">Page not found</h1>
			<p>This page doesn't exist. The link may be old or mistyped.</p>
			<a className="text-link" href="/">
				Go to the studio page
			</a>
		</main>
	);
}

/** One of the page's own paths: "/…", never "//…" or "/\\…". */
const OWN_PATH = /^\/(?![/\\])/;

/**
 * A page whose data failed to load. Never shows the error itself. "Try again"
 * is a link to the same path, without any fragment (a deposit link's token
 * lives there, and nothing may copy it into markup); where the browser can,
 * `reload` runs instead, which keeps the address as it is, fragment and all.
 */
export function ErrorPage({
	retryHref,
	reload,
}: {
	retryHref: string;
	reload?: () => void;
}) {
	const href = OWN_PATH.test(retryHref) ? retryHref.split("#", 1)[0] : "/";
	return (
		<main className="page status-page">
			<h1 className="section-title">This page can't load right now</h1>
			<p>Please try again in a minute.</p>
			<a
				className="text-link"
				href={href}
				onClick={
					reload
						? (event) => {
								event.preventDefault();
								reload();
							}
						: undefined
				}
			>
				Try again
			</a>
		</main>
	);
}

/** The router's error component: "Try again" loads the same address again. */
export function RouteErrorPage() {
	const href = useLocation({ select: (location) => location.href });
	return <ErrorPage retryHref={href} reload={() => window.location.reload()} />;
}
