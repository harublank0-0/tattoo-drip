import { useLocation } from "@tanstack/react-router";
import type { ArtistPageData, StudioPageData } from "../loaders.ts";
import { ArtistProfile, ArtistRoster } from "./artists.tsx";
import { ContactBlock } from "./contact.tsx";
import { InquirySection } from "./inquiry.tsx";

/**
 * The studio page's two pages and its status pages (TAT-48). Props only and
 * plain anchors: no router or query hooks (except RouteErrorPage, the
 * router's glue), so test/studio/render.test.ts renders them on their own.
 */

export function StudioPage({ data }: { data: StudioPageData }) {
	const { studio, artists, inquiry, channels } = data;
	return (
		<>
			<main className="page">
				<header className="profile">
					<div className="profile-heading">
						<h1 className="profile-name" dir="auto">
							{studio.name}
						</h1>
						<p className="profile-type">{studio.typeLabel}</p>
					</div>
					{studio.intro ? (
						<p className="profile-intro user-text measure" dir="auto">
							{studio.intro}
						</p>
					) : null}
					<div className="profile-actions">
						{studio.accepting ? (
							<div className="actions">
								<a className="action action-primary" href="#inquiry">
									Send an inquiry
								</a>
							</div>
						) : (
							<p className="status status-closed">
								Not taking new inquiries right now
							</p>
						)}
						<ContactBlock studio={studio} />
					</div>
				</header>
				<ArtistRoster artists={artists} />
				<InquirySection state={inquiry} channels={channels} />
			</main>
			<SiteFooter studioName={studio.name} />
		</>
	);
}

export function ArtistPage({ data }: { data: ArtistPageData }) {
	const { studio, artist, inquiry, channels } = data;
	return (
		<>
			<header className="site-bar">
				<a href="/" dir="auto">
					{studio.name}
				</a>
			</header>
			<main className="page">
				<ArtistProfile artist={artist} studio={studio} />
				<InquirySection state={inquiry} channels={channels} />
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

/** A page whose data failed to load. Never shows the error itself. */
export function ErrorPage({ retryHref }: { retryHref: string }) {
	return (
		<main className="page status-page">
			<h1 className="section-title">This page can't load right now</h1>
			<p>Please try again in a minute.</p>
			<a
				className="text-link"
				href={OWN_PATH.test(retryHref) ? retryHref : "/"}
			>
				Try again
			</a>
		</main>
	);
}

/** The router's error component: "Try again" reloads the same address. */
export function RouteErrorPage() {
	const href = useLocation({ select: (location) => location.href });
	return <ErrorPage retryHref={href} />;
}
