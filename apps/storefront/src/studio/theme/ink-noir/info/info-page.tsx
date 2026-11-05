import type { ReactNode } from "react";
import { Fill } from "../../../../intake/components/fill.tsx";
import {
	ContactDetails,
	FaqGroups,
	infoWords,
	PolicySections,
	Prose,
} from "../../../components/info.tsx";
import { RouterAnchor } from "../../../components/router-anchor.tsx";
import type { Shell } from "../../../components/shell.tsx";
import { BookingCta } from "../../../components/storefront.tsx";
import type { InfoContent } from "../../../info.ts";
import {
	artistsHref,
	flashHref,
	infoHref,
	isAllowedHref,
} from "../../../links.ts";
import type { InfoPageData } from "../../../loaders.ts";
import type { ArtistView } from "../../../view-model.ts";
import { Lines, SectionHead } from "../home/parts.tsx";
import { InkNoirShell } from "../shell.tsx";

/** Ink Noir's informational pages' words: editorial lines only, never a claim about a studio. */
const copy = {
	label: {
		about: "About",
		services: "What we tattoo",
		faq: "FAQ",
		contact: "Contact",
		policies: "Policies",
		aftercare: "Aftercare",
	},
	lines: {
		about: ["More than ink.", "A mark that lasts."],
		services: ["The art of", "making it yours."],
		faq: ["Good questions.", "Honest answers."],
		contact: ["Let's talk about", "your next piece."],
		policies: ["The details", "matter."],
		aftercare: ["Good art deserves", "good care."],
	},
	story: { label: "The story", title: "Our story", soloTitle: "The story" },
	specialties: { label: "Specialties", title: "What the work is about" },
	artists: {
		label: "The artists",
		title: "Meet the artists",
		soloLabel: "The artist",
		soloTitle: "Meet the artist",
		all: "View all artists",
		portfolio: "View portfolio",
	},
	services: {
		styles: { label: "Styles", title: "The work, by style" },
		by: "By",
		work: "See the work",
		artists: "Artists",
		flash: {
			title: "Flash",
			line: "Ready-drawn designs you can ask for as they are.",
			link: "See the flash",
		},
		custom: {
			title: "Custom work",
			line: "Ask for a design of your own: describe your idea, add references and say where it goes.",
			link: "Request a session",
		},
		pricing:
			"Prices aren't listed here: ask {studio} when you request a piece.",
	},
	close: {
		book: {
			lines: ["Your next story", "starts here."],
			button: "Book a session",
		},
		questions: { lines: ["Still have", "questions?"], button: "Get in touch" },
	},
	aftercare: {
		before: { n: "01", title: "Before your session" },
		after: { n: "02", title: "After your session" },
		policies: "Policies",
		contact: "Contact the studio",
	},
} as const;

/**
 * Ink Noir's informational pages (Prompt 7): one editorial opening per page
 * (its label and headline over a hairline; About's with the studio's cover
 * beside it), then the page's own layout of its content (src/studio/info.ts):
 * About's asymmetric story, specialties and artists; Services' style index;
 * the FAQ's groups; Contact's ways to reach the studio; Policies' contents
 * and sections; Aftercare's two numbered parts. Each closes on an invitation
 * that leads somewhere real. Only the studio's own content and the approved
 * product facts; a part without data is left out.
 */
export function InkNoirInfoPage({
	data,
	Shell = InkNoirShell,
}: {
	data: InfoPageData;
	Shell?: Shell;
}) {
	const { studio, theme, content } = data;
	const cover = content.kind === "about" ? theme.heroImage : null;
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page={content.kind}
			artistsShown={data.hasArtists}
			mainClassName={`ink-home ink-info ink-info-${content.kind}`}
		>
			<header
				className={
					cover ? "ink-info-hero ink-info-hero-photo" : "ink-info-hero"
				}
			>
				<div className="ink-container ink-info-hero-grid">
					<div className="ink-info-hero-text">
						<p className="ink-label">
							{content.kind === "about" ? (
								<>
									{copy.label.about} <bdi>{studio.name}</bdi>
								</>
							) : (
								copy.label[content.kind]
							)}
						</p>
						<h1 className="ink-info-title">
							{/* The page's name first, for heading navigation; the headline is what shows. */}
							<span className="sr-only">{copy.label[content.kind]}: </span>
							<Lines lines={copy.lines[content.kind]} />
						</h1>
					</div>
					{cover ? (
						<figure className="ink-info-cover">
							<img
								src={cover.src}
								srcSet={cover.srcSet}
								sizes={
									cover.srcSet ? "(min-width: 60rem) 40vw, 100vw" : undefined
								}
								width={cover.width}
								height={cover.height}
								alt={cover.alt}
								loading="eager"
								decoding="async"
								fetchPriority="high"
							/>
						</figure>
					) : null}
				</div>
			</header>
			<InfoBody data={data} content={content} />
			<Close data={data} />
		</Shell>
	);
}

function InfoBody({
	data,
	content,
}: {
	data: InfoPageData;
	content: InfoContent;
}) {
	const { studio } = data;
	switch (content.kind) {
		case "about":
			return (
				<>
					{content.story.length > 0 ? (
						<section
							className="ink-section ink-info-story"
							aria-labelledby="info-story-title"
						>
							<div className="ink-container ink-info-split">
								<SectionHead id="info-story-title" label={copy.story.label}>
									{content.independent
										? copy.story.soloTitle
										: copy.story.title}
								</SectionHead>
								<div className="ink-info-prose">
									<Prose paragraphs={content.story} />
								</div>
							</div>
						</section>
					) : null}
					{content.specialties.length > 0 ? (
						<section
							className="ink-section ink-info-specialties"
							aria-labelledby="info-specialties-title"
						>
							<div className="ink-container">
								<SectionHead
									id="info-specialties-title"
									label={copy.specialties.label}
								>
									{copy.specialties.title}
								</SectionHead>
								<p className="ink-info-specialty-line">
									{content.specialties.join(" · ")}
								</p>
							</div>
						</section>
					) : null}
					<AboutArtists
						artists={content.artists}
						more={content.more}
						solo={content.independent}
					/>
				</>
			);
		case "services":
			return (
				<section className="ink-section" aria-labelledby="info-styles-title">
					<div className="ink-container">
						{content.styles.length > 0 ? (
							<>
								<SectionHead
									id="info-styles-title"
									label={copy.services.styles.label}
								>
									{copy.services.styles.title}
								</SectionHead>
								{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
								<ol
									className="ink-info-index"
									// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
									role="list"
								>
									{content.styles.map((style, index) => (
										<li key={style.name} className="ink-info-index-item">
											<span className="ink-info-index-n" aria-hidden="true">
												{String(index + 1).padStart(2, "0")}
											</span>
											<h3 className="ink-info-index-name" dir="auto">
												{style.name}
											</h3>
											<p className="ink-info-index-by">
												{copy.services.by}{" "}
												{style.artists.map((artist, i) => (
													<span key={artist.href}>
														{i > 0 ? ", " : null}
														<RouterAnchor href={artist.href}>
															<bdi>{artist.name}</bdi>
														</RouterAnchor>
													</span>
												))}
											</p>
											{style.workHref && isAllowedHref(style.workHref) ? (
												<RouterAnchor
													className="ink-link"
													href={style.workHref}
													aria-label={`${copy.services.work}: ${style.name}`}
												>
													{copy.services.work}
												</RouterAnchor>
											) : null}
										</li>
									))}
								</ol>
							</>
						) : (
							<h2 id="info-styles-title" className="sr-only">
								{copy.label.services}
							</h2>
						)}
						<div className="ink-info-offers">
							{content.requestHref ? (
								<div className="ink-info-offer">
									<h3>{copy.services.custom.title}</h3>
									<p>{copy.services.custom.line}</p>
									<RouterAnchor className="ink-link" href={content.requestHref}>
										{copy.services.custom.link}
									</RouterAnchor>
								</div>
							) : null}
							{content.flash ? (
								<div className="ink-info-offer">
									<h3>{copy.services.flash.title}</h3>
									<p>{copy.services.flash.line}</p>
									<RouterAnchor className="ink-link" href={flashHref({})}>
										{copy.services.flash.link}
									</RouterAnchor>
								</div>
							) : null}
						</div>
						<p className="ink-info-note">
							<Fill
								template={copy.services.pricing}
								values={{ studio: studio.name }}
							/>
						</p>
					</div>
				</section>
			);
		case "faq":
			return (
				<div className="ink-section">
					<div className="ink-container ink-info-split">
						{content.groups.length > 1 ? (
							<nav className="ink-info-toc" aria-label={infoWords.contents}>
								{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
								<ol
									// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
									role="list"
								>
									{content.groups.map((group) => (
										<li key={group.id}>
											<a href={`#faq-${group.id}`}>{group.title}</a>
										</li>
									))}
								</ol>
							</nav>
						) : (
							<span />
						)}
						<FaqGroups faq={content} className="faq ink-faq" />
					</div>
				</div>
			);
		case "contact":
			return (
				<div className="ink-section">
					<div className="ink-container ink-info-contact">
						<ContactDetails studio={studio} contact={content} />
					</div>
				</div>
			);
		case "policies":
			return (
				<div className="ink-section">
					<div className="ink-container ink-info-policies">
						<PolicySections sections={content.sections} />
					</div>
				</div>
			);
		case "aftercare":
			return (
				<div className="ink-section">
					<div className="ink-container ink-info-care">
						<CarePart
							id="before"
							words={copy.aftercare.before}
							text={content.before}
						/>
						<CarePart
							id="after"
							words={copy.aftercare.after}
							text={content.after}
						/>
						<aside className="ink-info-callout">
							<p>
								<Fill
									template={infoWords.aftercareNote}
									values={{ studio: studio.name }}
								/>
							</p>
						</aside>
					</div>
				</div>
			);
	}
}

/** One numbered part of the aftercare page, in the studio's own words; nothing without them. */
function CarePart({
	id,
	words,
	text,
}: {
	id: string;
	words: { readonly n: string; readonly title: string };
	text: readonly string[];
}) {
	if (text.length === 0) return null;
	return (
		<section className="ink-info-care-part" aria-labelledby={`care-${id}`}>
			<p className="ink-info-care-n" aria-hidden="true">
				{words.n}
			</p>
			<h2 id={`care-${id}`} className="ink-info-care-title">
				{words.title}
			</h2>
			<div className="ink-info-prose">
				<Prose paragraphs={text} />
			</div>
		</section>
	);
}

/** About's artists: up to four portraits with their first style and portfolio, or the one artist. */
function AboutArtists({
	artists,
	more,
	solo,
}: {
	artists: readonly ArtistView[];
	more: boolean;
	solo: boolean;
}) {
	if (artists.length === 0) return null;
	return (
		<section
			className="ink-section ink-info-artists"
			aria-labelledby="info-artists-title"
		>
			<div className="ink-container">
				<div className="ink-work-head">
					<SectionHead
						id="info-artists-title"
						label={solo ? copy.artists.soloLabel : copy.artists.label}
					>
						{solo ? copy.artists.soloTitle : copy.artists.title}
					</SectionHead>
					{more ? (
						<RouterAnchor className="ink-link" href={artistsHref({})}>
							{copy.artists.all}
						</RouterAnchor>
					) : null}
				</div>
				{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
				<ul
					className="ink-info-people"
					// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
					role="list"
				>
					{artists.map((artist) => (
						<li key={artist.slug} className="ink-info-person">
							{artist.photo ? (
								<img
									className="ink-info-person-photo"
									src={artist.photo.src}
									srcSet={artist.photo.srcSet}
									sizes={
										artist.photo.srcSet
											? "(min-width: 60rem) 18rem, 50vw"
											: undefined
									}
									width={artist.photo.width}
									height={artist.photo.height}
									alt={artist.photo.alt}
									loading="lazy"
									decoding="async"
								/>
							) : (
								<span className="ink-info-person-photo" aria-hidden="true" />
							)}
							<h3 className="ink-info-person-name" dir="auto">
								{artist.name}
							</h3>
							{artist.styles[0] ? (
								<p className="ink-info-person-style">{artist.styles[0]}</p>
							) : null}
							{solo && artist.bio ? (
								<p className="ink-info-person-bio user-text" dir="auto">
									{artist.bio}
								</p>
							) : null}
							<RouterAnchor
								className="ink-link"
								href={artist.pageHref}
								aria-label={`${copy.artists.portfolio}: ${artist.name}`}
							>
								{copy.artists.portfolio}
							</RouterAnchor>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}

/**
 * The closing invitation: the FAQ asks "Still have questions?" towards
 * Contact (when there is a way to reach the studio); every other page invites
 * a booking while someone takes new work. Nothing when it has nowhere to lead.
 */
function Close({ data }: { data: InfoPageData }) {
	const { content, studio, requestLink } = data;
	const questions = content.kind === "faq" || content.kind === "aftercare";
	const contact = questions && studio.pages.contact;
	if (content.kind === "contact") {
		return requestLink ? (
			<CloseSection lines={copy.close.book.lines}>
				<BookingCta link={requestLink} className="ink-cta" />
			</CloseSection>
		) : null;
	}
	if (contact) {
		return (
			<CloseSection lines={copy.close.questions.lines}>
				<RouterAnchor
					className="action action-primary ink-cta"
					href={infoHref("contact")}
				>
					{copy.close.questions.button}
				</RouterAnchor>
			</CloseSection>
		);
	}
	if (!requestLink || !isAllowedHref(requestLink.href)) return null;
	return (
		<CloseSection lines={copy.close.book.lines}>
			<RouterAnchor
				className="action action-primary ink-cta"
				href={requestLink.href}
			>
				{copy.close.book.button}
			</RouterAnchor>
		</CloseSection>
	);
}

function CloseSection({
	lines,
	children,
}: {
	lines: readonly string[];
	children: ReactNode;
}) {
	return (
		<section
			className="ink-section ink-close"
			aria-labelledby="info-close-title"
		>
			<div className="ink-container ink-close-grid">
				<h2 id="info-close-title" className="ink-close-title">
					<Lines lines={lines} />
				</h2>
				<div className="ink-close-body">
					<div className="ink-hero-actions">{children}</div>
				</div>
			</div>
		</section>
	);
}
