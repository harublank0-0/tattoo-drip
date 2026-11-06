import { Fill } from "../../intake/components/fill.tsx";
import { fill } from "../../intake/template.ts";
import { studioCopy } from "../copy.ts";
import {
	type ContactContent,
	type FaqContent,
	type InfoContent,
	infoCopy,
	type Paragraphs,
	type PolicySection,
} from "../info.ts";
import { isAllowedHref, linkRel } from "../links.ts";
import type { InfoPageData } from "../loaders.ts";
import type { StudioView } from "../view-model.ts";
import { contactGroups } from "./contact.tsx";
import { type Shell, StencilShell } from "./shell.tsx";

/*
 * The informational pages' pieces (Prompt 7), for every theme: the studio's
 * own text as paragraphs, the FAQ as disclosures, the policies with their
 * contents list, and the ways to reach the studio. Props only; a theme lays
 * them out (Ink Noir's src/studio/theme/ink-noir/info/) or uses InfoPage, the
 * plain page Stencil & Ink renders.
 */

/** The informational pages' plain titles (a theme may set its own headline). */
export const INFO_TITLES: Record<InfoContent["kind"], string> = {
	about: "About",
	services: "What we tattoo",
	faq: "Questions",
	contact: "Contact",
	policies: "Policies",
	aftercare: "Aftercare",
};

export const infoWords = {
	before: "Before your session",
	after: "After your session",
	contents: "On this page",
	directions: "Get directions",
	hours: "Opening hours",
	closed: "Closed days",
	reach: "Reach",
	follow: "Follow",
	noLocation: "The studio hasn't published an address.",
	noLocationAsk:
		"The studio hasn't published an address. Message them to ask where to find them.",
	aftercareNote:
		"These are {studio}'s own instructions. For anything that worries you while it heals, ask your artist or a healthcare professional.",
	fromStudio: "From {studio}",
	updated: "Last updated {date}",
	more: "More about {studio}",
} as const;

/** The studio's own text, one paragraph per block, line breaks kept. */
export function Prose({
	paragraphs,
	className,
}: {
	paragraphs: Paragraphs;
	className?: string;
}) {
	return (
		<>
			{paragraphs.map((text, index) => (
				<p
					// biome-ignore lint/suspicious/noArrayIndexKey: a paragraph has no id; the same words may repeat, and the order never changes
					key={`${index}:${text}`}
					className={className ? `${className} user-text` : "user-text"}
					dir="auto"
				>
					{text}
				</p>
			))}
		</>
	);
}

/**
 * The FAQ: a section per group (an h2), each question a `<details>` (the
 * browser's own disclosure: keyboard, focus and state are native), its
 * answer as text and, where a page says more, a link to it.
 */
export function FaqGroups({
	faq,
	className = "faq",
}: {
	faq: FaqContent;
	className?: string;
}) {
	return (
		<div className={className}>
			{faq.groups.map((group) => (
				<section
					key={group.id}
					id={`faq-${group.id}`}
					className="faq-group"
					aria-labelledby={`faq-${group.id}-title`}
				>
					<h2
						id={`faq-${group.id}-title`}
						className={
							group.studioName
								? "faq-group-title faq-group-title-studio"
								: "faq-group-title"
						}
					>
						<FaqGroupTitle group={group} />
					</h2>
					{group.items.map((item) => (
						<details key={item.id} id={item.id} className="faq-item">
							<summary className="faq-question">
								<span>{item.question}</span>
							</summary>
							<div className="faq-answer">
								<Prose paragraphs={item.answer} />
								{item.link && isAllowedHref(item.link.href) ? (
									<p>
										<a className="text-link" href={item.link.href}>
											{item.link.label}
										</a>
									</p>
								) : null}
							</div>
						</details>
					))}
				</section>
			))}
		</div>
	);
}

/**
 * A FAQ group's title: the studio's own group names the studio in <bdi>
 * (its name may be Devanagari or right-to-left), the others are product
 * words.
 */
export function FaqGroupTitle({
	group,
}: {
	group: FaqContent["groups"][number];
}) {
	return group.studioName ? (
		<Fill
			template={infoCopy.faq.fromStudio}
			values={{ studio: group.studioName }}
		/>
	) : (
		group.title
	);
}

/** The policies: a contents list of anchors, then a section per policy. */
export function PolicySections({
	sections,
	updatedAt = null,
}: {
	sections: readonly PolicySection[];
	/** "6 November 2026", or null for no date line. */
	updatedAt?: string | null;
}) {
	return (
		<div className="policies">
			{updatedAt ? (
				<p className="policies-updated">
					{fill(infoWords.updated, { date: updatedAt })}
				</p>
			) : null}
			{sections.length > 1 ? (
				<nav className="policies-contents" aria-label={infoWords.contents}>
					{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
					<ol
						// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
						role="list"
					>
						{sections.map((section) => (
							<li key={section.id}>
								<a href={`#${section.id}`}>{section.title}</a>
							</li>
						))}
					</ol>
				</nav>
			) : null}
			{sections.map((section) => (
				<section
					key={section.id}
					id={section.id}
					className="policy"
					aria-labelledby={`${section.id}-title`}
				>
					<h2 id={`${section.id}-title`} className="policy-title">
						{section.title}
					</h2>
					<Prose paragraphs={section.text} />
					{section.list ? (
						<ul className="policy-list">
							{section.list.map((line) => (
								<li key={line} className="user-text" dir="auto">
									{line}
								</li>
							))}
						</ul>
					) : null}
				</section>
			))}
		</div>
	);
}

/**
 * The ways to reach the studio: its chat, call and email links, its social
 * profiles, its address with directions (Google Maps, a link: no embed, so
 * no third party loads in the page), its opening hours and closed days.
 * Each part only when the studio set it; without an address it says so.
 */
export function ContactDetails({
	studio,
	contact,
}: {
	studio: StudioView;
	contact: ContactContent;
}) {
	const { chat, follow, address } = contactGroups(studio);
	return (
		<div className="contact-details">
			{chat.length > 0 ? (
				<section className="contact-part" aria-labelledby="contact-reach">
					<h2 id="contact-reach" className="contact-part-title">
						{infoWords.reach}
					</h2>
					<LinkList links={chat} />
				</section>
			) : null}
			<section className="contact-part" aria-labelledby="contact-visit">
				<h2 id="contact-visit" className="contact-part-title">
					{studioCopy.contact.visit}
				</h2>
				{address ? (
					<>
						<p className="user-text" dir="auto">
							{address.text}
						</p>
						<p>
							<a
								className="text-link"
								href={address.mapsHref}
								rel={linkRel(address.mapsHref)}
							>
								{infoWords.directions}
							</a>
						</p>
					</>
				) : (
					<p>
						{chat.length > 0 ? infoWords.noLocationAsk : infoWords.noLocation}
					</p>
				)}
			</section>
			{studio.hours.length > 0 ? (
				<section className="contact-part" aria-labelledby="contact-hours">
					<h2 id="contact-hours" className="contact-part-title">
						{infoWords.hours}
					</h2>
					<dl className="contact-hours">
						{studio.hours.map((line) => (
							<div key={line.days}>
								<dt>{line.days}</dt>
								<dd>{line.hours}</dd>
							</div>
						))}
					</dl>
				</section>
			) : null}
			{contact.closedDays.length > 0 ? (
				<section className="contact-part" aria-labelledby="contact-closed">
					<h2 id="contact-closed" className="contact-part-title">
						{infoWords.closed}
					</h2>
					<ul className="contact-closed">
						{contact.closedDays.map((day) => (
							<li key={day.when} className="user-text" dir="auto">
								{day.when}
								{day.note ? `: ${day.note}` : ""}
							</li>
						))}
					</ul>
				</section>
			) : null}
			{follow.length > 0 ? (
				<section
					className="contact-part"
					aria-labelledby="contact-follow-title"
				>
					<h2 id="contact-follow-title" className="contact-part-title">
						{infoWords.follow}
					</h2>
					<LinkList links={follow} />
				</section>
			) : null}
		</div>
	);
}

function LinkList({
	links,
}: {
	links: readonly { readonly href: string; readonly label: string }[];
}) {
	return (
		<ul className="contact-links">
			{links.map((link) => (
				<li key={link.href}>
					<a className="text-link" href={link.href} rel={linkRel(link.href)}>
						{link.label}
					</a>
				</li>
			))}
		</ul>
	);
}

/**
 * Stencil & Ink's informational page: the title, then the content as plain
 * sections. The same data Ink Noir lays out editorially.
 */
export function InfoPage({
	data,
	Shell = StencilShell,
}: {
	data: InfoPageData;
	Shell?: Shell;
}) {
	const { studio, theme, content } = data;
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page={content.kind}
			artistsShown={data.hasArtists}
		>
			<section className="section info-page" aria-labelledby="info-title">
				<h1 id="info-title" className="section-title">
					{INFO_TITLES[content.kind]}
				</h1>
				<div className="stack measure">
					<InfoBody data={data} />
				</div>
			</section>
		</Shell>
	);
}

function InfoBody({ data }: { data: InfoPageData }) {
	const { content, studio } = data;
	switch (content.kind) {
		case "about":
			return (
				<>
					<Prose paragraphs={content.story} />
					{content.specialties.length > 0 ? (
						<p>{content.specialties.join(" · ")}</p>
					) : null}
					{content.artists.length > 0 ? (
						<ul className="info-artists">
							{content.artists.map((artist) => (
								<li key={artist.slug}>
									<a className="text-link" href={artist.pageHref}>
										<bdi>{artist.name}</bdi>
									</a>
								</li>
							))}
						</ul>
					) : null}
				</>
			);
		case "services":
			return content.styles.length === 0 ? null : (
				<ul className="info-styles">
					{content.styles.map((style) => (
						<li key={style.name}>
							{style.workHref ? (
								<a className="text-link" href={style.workHref}>
									{style.name}
								</a>
							) : (
								style.name
							)}
						</li>
					))}
				</ul>
			);
		case "faq":
			return <FaqGroups faq={content} />;
		case "contact":
			return <ContactDetails studio={studio} contact={content} />;
		case "policies":
			return (
				<PolicySections
					sections={content.sections}
					updatedAt={content.updatedAt}
				/>
			);
		case "aftercare":
			return (
				<>
					{content.before.length > 0 ? (
						<section aria-labelledby="aftercare-before">
							<h2 id="aftercare-before">{infoWords.before}</h2>
							<Prose paragraphs={content.before} />
						</section>
					) : null}
					{content.after.length > 0 ? (
						<section aria-labelledby="aftercare-after">
							<h2 id="aftercare-after">{infoWords.after}</h2>
							<Prose paragraphs={content.after} />
						</section>
					) : null}
				</>
			);
	}
}
