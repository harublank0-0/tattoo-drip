import type { Artist, Studio } from "@tattoo-drip/sdk";
import { fill } from "../intake/template.ts";
import { filterStyles } from "./gallery.ts";
import { closedDaysText, readClosures } from "./hours.ts";
import { artistsHref, requestHref, workHref } from "./links.ts";
import { cleanText } from "./text.ts";
import type { SectionKey } from "./theme/config.ts";
import type { ArtistView, StudioView } from "./view-model.ts";

/**
 * The informational pages (Prompt 7): About, Services, FAQ, Contact, Policies
 * and Aftercare, as content every theme can lay out its own way. Pure. Each
 * is built only from the studio's and its artists' own data, the reads every
 * page already makes; the one other source is a few fixed answers about how
 * requesting works on Tattoo Drip, true for every studio (approved for the
 * FAQ). Nothing here invents a service, a price, a policy, a timeline or a
 * claim: a part without data is left out, and a page with nothing of its own
 * is a not-found (infoContent gives null).
 *
 * The platform has no content for services, FAQs, policies, studio photos or
 * a contact message (docs/development.md, "Informational pages"); the pages
 * say only what the studio's profile, its Good to know and its artists say.
 */

export const INFO_PAGES = [
	"about",
	"services",
	"faq",
	"contact",
	"policies",
	"aftercare",
] as const;
export type InfoKind = (typeof INFO_PAGES)[number];

/** A block of the studio's own text: paragraphs, split on blank lines; each keeps its line breaks. */
export type Paragraphs = readonly string[];

export interface AboutContent {
	readonly kind: "about";
	readonly independent: boolean;
	/** The studio's own introduction, as paragraphs; [] when it wrote none. */
	readonly story: Paragraphs;
	/** The styles its artists list, in their order, each once. */
	readonly specialties: readonly string[];
	/** The artists to meet: up to four for a studio; the artist themself when independent. */
	readonly artists: readonly ArtistView[];
	/** Whether there are more artists than shown, so "All artists" leads somewhere new. */
	readonly more: boolean;
}

export interface ServiceStyle {
	readonly name: string;
	/** The gallery filtered by it, when its slug can be an address; else null. */
	readonly workHref: string | null;
	/** The artists filtered by it, when its slug can be an address; else null. */
	readonly artistsHref: string | null;
	readonly artists: readonly { readonly name: string; readonly href: string }[];
}

export interface ServicesContent {
	readonly kind: "services";
	/** The styles the studio's visible artists list; [] when none does. */
	readonly styles: readonly ServiceStyle[];
	/** Whether the studio shows flash (its Flash section is on). */
	readonly flash: boolean;
	/** Custom work's request, while someone takes new work; else null. */
	readonly requestHref: string | null;
}

export interface FaqItem {
	readonly id: string;
	readonly question: string;
	readonly answer: Paragraphs;
	/** Where to go next, when a page says more. */
	readonly link: { readonly href: string; readonly label: string } | null;
	/** "studio" when the studio wrote the answer, "product" for how Tattoo Drip works. */
	readonly source: "studio" | "product";
}

export interface FaqContent {
	readonly kind: "faq";
	readonly groups: readonly {
		readonly id: string;
		readonly title: string;
		readonly items: readonly FaqItem[];
	}[];
}

export interface ContactContent {
	readonly kind: "contact";
	/** The upcoming closed days, worded without a year. */
	readonly closedDays: readonly {
		readonly when: string;
		readonly note: string | null;
	}[];
}

export interface PolicySection {
	readonly id: string;
	readonly title: string;
	readonly text: Paragraphs;
	/** Closed days, listed. */
	readonly list?: readonly string[];
}

export interface PoliciesContent {
	readonly kind: "policies";
	readonly sections: readonly PolicySection[];
}

export interface AftercareContent {
	readonly kind: "aftercare";
	/** "Before your session", in the studio's words; [] when none. */
	readonly before: Paragraphs;
	/** Aftercare, in the studio's words; [] when none. */
	readonly after: Paragraphs;
}

export type InfoContent =
	| AboutContent
	| ServicesContent
	| FaqContent
	| ContactContent
	| PoliciesContent
	| AftercareContent;

/** The words of the pages' parts, in English: product wording only, never a studio's claim. */
export const infoCopy = {
	faq: {
		booking: "Booking",
		before: "Before your session",
		pricing: "Pricing and deposits",
		healing: "Healing",
		how: {
			question: "How do I book a session?",
			answer:
				"Send a request from the booking page: your idea, a few dates that suit you and how to reach you. {studio} reads it and replies to talk it through and agree a time.",
			link: "Request a session",
		},
		confirmed: {
			question: "Is my session booked when I send a request?",
			answer:
				"Not yet. {studio} reviews every request first. Your session is booked once you agree a time with them.",
		},
		references: {
			question: "Can I bring my own design or reference photos?",
			answer:
				"Yes. Add up to five reference photos to your request: designs you like, or the spot on your body. Only {studio} sees them.",
		},
		walkIns: "Do you take walk-ins?",
		age: "Is there an age requirement?",
		prepare: "How should I prepare for my session?",
		deposit: "Is a deposit required?",
		aftercare: "How do I look after a new tattoo?",
		aftercareLink: "Aftercare",
	},
	policies: {
		deposits: "Deposits",
		age: "Age",
		walkIns: "Walk-ins",
		closed: "Closed days",
	},
} as const;

/** The studio's own text as paragraphs: split on blank lines, trimmed, empty ones dropped. */
export function paragraphs(text: string | null | undefined): Paragraphs {
	const clean = cleanText(text);
	if (!clean) return [];
	return clean
		.split(/\n\s*\n/)
		.map((part) => part.trim())
		.filter(Boolean);
}

/**
 * The page's content, or null when it has nothing of the studio's own (the
 * route's not-found). `sections` are the studio's chosen page sections: with
 * Good to know (`info`) hidden, its words appear on no page either.
 */
export function infoContent(
	kind: InfoKind,
	studio: Studio,
	view: StudioView,
	raw: readonly Artist[],
	artists: readonly ArtistView[],
	sections: readonly SectionKey[],
): InfoContent | null {
	const texts = sections.includes("info")
		? ((studio.goodToKnow ?? {}) as Partial<Studio["goodToKnow"]>)
		: {};
	switch (kind) {
		case "about":
			return aboutContent(view, artists);
		case "services":
			return artists.length > 0
				? servicesContent(view, raw, artists, sections)
				: null;
		case "faq":
			return faqContent(view, texts);
		case "contact":
			return view.pages.contact
				? {
						kind: "contact",
						closedDays: readClosures(studio.closedDays).map((closure) => ({
							when: closedDaysText(closure.from, closure.to),
							note: closure.note,
						})),
					}
				: null;
		case "policies":
			return sections.includes("info") ? policiesContent(texts, studio) : null;
		case "aftercare": {
			const before = paragraphs(texts.beforeSession);
			const after = paragraphs(texts.aftercare);
			return before.length + after.length > 0
				? { kind: "aftercare", before, after }
				: null;
		}
	}
}

/** About: the studio's own introduction, its artists' styles and its artists. */
function aboutContent(
	view: StudioView,
	artists: readonly ArtistView[],
): AboutContent {
	const specialties: string[] = [];
	for (const artist of artists) {
		for (const style of artist.styles) {
			if (!specialties.includes(style)) specialties.push(style);
		}
	}
	const independent = view.type === "independent";
	const shown = independent ? artists.slice(0, 1) : artists.slice(0, 4);
	return {
		kind: "about",
		independent,
		story: paragraphs(view.intro),
		specialties,
		artists: shown,
		more: artists.length > shown.length,
	};
}

/** Services: what the studio's artists list, flash when it shows it, and custom work. */
function servicesContent(
	view: StudioView,
	raw: readonly Artist[],
	artists: readonly ArtistView[],
	sections: readonly SectionKey[],
): ServicesContent {
	const visible = new Set(artists.map((artist) => artist.slug));
	const styles: {
		name: string;
		slug: string | null;
		artists: { name: string; href: string }[];
	}[] = [];
	for (const artist of raw) {
		if (!visible.has(artist.slug)) continue;
		const own = artists.find((each) => each.slug === artist.slug);
		if (!own) continue;
		const refs = filterStyles(artist.styles);
		for (const name of own.styles) {
			const slug = refs.find((ref) => ref.name === name)?.slug ?? null;
			let style = styles.find((each) => each.name === name);
			if (!style) {
				style = { name, slug, artists: [] };
				styles.push(style);
			}
			style.artists.push({ name: own.name, href: own.pageHref });
		}
	}
	return {
		kind: "services",
		styles: styles.map((style) => ({
			name: style.name,
			workHref: style.slug ? workHref({ style: style.slug }) : null,
			artistsHref: style.slug ? artistsHref({ style: style.slug }) : null,
			artists: style.artists,
		})),
		flash: sections.includes("flash"),
		requestHref:
			view.accepting || artists.some((a) => a.accepting)
				? requestHref({})
				: null,
	};
}

/**
 * The FAQ: how requesting works (Tattoo Drip's own facts, true for every
 * studio), then the studio's own answers from its Good to know, each only when
 * it wrote one. Groups without an answer are left out.
 */
function faqContent(
	view: StudioView,
	texts: Partial<Studio["goodToKnow"]>,
): FaqContent {
	const words = infoCopy.faq;
	const studio = { studio: view.name };
	const own = (
		id: string,
		question: string,
		text: string | null | undefined,
		link: FaqItem["link"] = null,
	): FaqItem[] => {
		const answer = paragraphs(text);
		return answer.length > 0
			? [{ id, question, answer, link, source: "studio" }]
			: [];
	};
	const groups = [
		{
			id: "booking",
			title: words.booking,
			items: [
				{
					id: "how-to-book",
					question: words.how.question,
					answer: [fill(words.how.answer, studio)],
					link: { href: requestHref({}), label: words.how.link },
					source: "product" as const,
				},
				{
					id: "is-it-booked",
					question: words.confirmed.question,
					answer: [fill(words.confirmed.answer, studio)],
					link: null,
					source: "product" as const,
				},
				{
					id: "own-design",
					question: words.references.question,
					answer: [fill(words.references.answer, studio)],
					link: null,
					source: "product" as const,
				},
				...own("walk-ins", words.walkIns, texts.walkIns),
			],
		},
		{
			id: "before",
			title: words.before,
			items: [
				...own("age", words.age, texts.ageRule),
				...own("prepare", words.prepare, texts.beforeSession),
			],
		},
		{
			id: "pricing",
			title: words.pricing,
			items: own("deposit", words.deposit, texts.depositPolicy),
		},
		{
			id: "healing",
			title: words.healing,
			items: own("aftercare", words.aftercare, texts.aftercare, {
				href: "/aftercare",
				label: words.aftercareLink,
			}),
		},
	];
	return {
		kind: "faq",
		groups: groups.filter((group) => group.items.length > 0),
	};
}

/** Policies: the studio's deposit policy, age rule, walk-ins and closed days, each only when set. */
function policiesContent(
	texts: Partial<Studio["goodToKnow"]>,
	studio: Studio,
): PoliciesContent | null {
	const words = infoCopy.policies;
	const closures = readClosures(studio.closedDays);
	const sections: PolicySection[] = [
		{
			id: "deposits",
			title: words.deposits,
			text: paragraphs(texts.depositPolicy),
		},
		{ id: "age", title: words.age, text: paragraphs(texts.ageRule) },
		{ id: "walk-ins", title: words.walkIns, text: paragraphs(texts.walkIns) },
	].filter((section) => section.text.length > 0);
	if (closures.length > 0) {
		sections.push({
			id: "closed-days",
			title: words.closed,
			text: [],
			list: closures.map(
				(closure) =>
					`${closedDaysText(closure.from, closure.to)}${closure.note ? `: ${closure.note}` : ""}`,
			),
		});
	}
	return sections.length > 0 ? { kind: "policies", sections } : null;
}
