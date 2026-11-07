import { Link } from "@tanstack/react-router";
import type {
	DiscoverArtistSummary,
	DiscoverStudioSummary,
	DiscoverTattooSummary,
} from "@tattoo-drip/sdk";
import { ArrowRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
	EditorialSection,
	SectionHeading,
} from "#/components/discovery/layout";
import { ResponsiveImage } from "#/components/discovery/responsive-image";
import { profileDestination } from "#/lib/destinations";
import { tattooAlt, tattooCredit } from "#/lib/home";

/** A link to a full directory (or another page), with an arrow. */
export function MoreLink({
	to,
	search,
	children,
}: {
	to: string;
	search?: Record<string, string | undefined>;
	children: ReactNode;
}) {
	return (
		<Link
			to={to}
			search={search as never}
			className="group inline-flex min-h-11 shrink-0 items-center gap-2 self-start font-medium underline-offset-4 hover:underline"
		>
			{children}
			<ArrowRightIcon
				className="size-4 transition-transform motion-safe:group-hover:translate-x-0.5"
				aria-hidden="true"
			/>
		</Link>
	);
}

/** A hub's section: heading, optional intro and "all of them" link, then its content. */
export function HubSection({
	id,
	eyebrow,
	title,
	intro,
	more,
	tone,
	children,
}: {
	id: string;
	eyebrow?: string;
	title: string;
	intro?: ReactNode;
	more?: ReactNode;
	tone?: "paper" | "sunk" | "night";
	children: ReactNode;
}) {
	return (
		<EditorialSection tone={tone} labelledBy={id} className="lg:py-20">
			<div className="mb-8 flex flex-col gap-4 lg:mb-12 lg:flex-row lg:items-end lg:justify-between">
				<SectionHeading id={id} eyebrow={eyebrow} title={title} intro={intro} />
				{more}
			</div>
			{children}
		</EditorialSection>
	);
}

/** Where a photo links: its artist's or studio's page when the hub's own data holds it. */
function workDestination(
	tattoo: DiscoverTattooSummary,
	artists: readonly DiscoverArtistSummary[],
	studios: readonly DiscoverStudioSummary[],
): string | undefined {
	const artist = artists.find((each) => each.id === tattoo.artist.id);
	if (artist) return profileDestination(artist).href;
	const studio = studios.find((each) => each.slug === tattoo.studio.slug);
	return studio ? profileDestination(studio).href : undefined;
}

/**
 * Recent published work in columns at each photo's true proportions (fixed
 * frames, lazy), credited "artist · studio". Discover's artwork pages are
 * D09: a photo links to its artist's or studio's page when the hub holds it.
 */
export function WorkColumns({
	tattoos,
	artists,
	studios,
}: {
	tattoos: readonly DiscoverTattooSummary[];
	artists: readonly DiscoverArtistSummary[];
	studios: readonly DiscoverStudioSummary[];
}) {
	return (
		<ul className="columns-2 gap-3 sm:columns-3 sm:gap-4 lg:columns-4 lg:gap-6">
			{tattoos.map((tattoo) => {
				const href = workDestination(tattoo, artists, studios);
				const ratio =
					tattoo.image.width > 0 && tattoo.image.height > 0
						? `${tattoo.image.width} / ${tattoo.image.height}`
						: "4 / 5";
				const body = (
					<figure className="flex flex-col gap-2">
						<ResponsiveImage
							image={tattoo.image}
							alt={tattooAlt(tattoo)}
							ratio={ratio}
							sizes="(min-width: 64rem) 22vw, (min-width: 40rem) 33vw, 50vw"
							className="bg-night-raised"
						/>
						<figcaption className="text-sm text-night-muted">
							{tattooCredit(tattoo)}
						</figcaption>
					</figure>
				);
				return (
					<li key={tattoo.id} className="mb-6 break-inside-avoid">
						{href ? (
							<a href={href} className="group block">
								{body}
								<span className="sr-only">
									(their page on the studio's site)
								</span>
							</a>
						) : (
							body
						)}
					</li>
				);
			})}
		</ul>
	);
}

/** A row of plain text links (styles, places): no counts. */
export function LinkList({
	label,
	links,
}: {
	label: string;
	links: {
		key: string;
		to: string;
		search?: Record<string, string | undefined>;
		text: string;
		note?: string | null;
	}[];
}) {
	return (
		<ul
			aria-label={label}
			className="flex flex-wrap gap-x-8 gap-y-1 border-t border-ink pt-4"
		>
			{links.map((link) => (
				<li key={link.key}>
					<Link
						to={link.to}
						search={link.search as never}
						className="inline-flex min-h-11 items-baseline gap-2 font-display text-display-md font-bold decoration-accent decoration-2 underline-offset-[0.2em] hover:underline"
					>
						{link.text}
						{link.note && (
							<span className="font-sans text-sm font-normal text-ink-muted">
								{link.note}
							</span>
						)}
					</Link>
				</li>
			))}
		</ul>
	);
}
