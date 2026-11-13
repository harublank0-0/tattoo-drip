import { MapPin } from "lucide-react";
import type { ReactNode } from "react";
import { contactGroups } from "../../components/contact.tsx";
import { NavList } from "../../components/nav-list.tsx";
import { BookingCta } from "../../components/storefront.tsx";
import { studioCopy } from "../../copy.ts";
import { linkRel } from "../../links.ts";
import type { NavItem } from "../../nav.ts";
import type { RequestLink } from "../../request.ts";
import type { ContactLink, StudioView } from "../../view-model.ts";
import { StarRow } from "./ornaments.tsx";

function Column({
	id,
	title,
	children,
}: {
	id: string;
	title: string;
	children: ReactNode;
}) {
	return (
		<section className="fp-footer-column" aria-labelledby={id}>
			<h2 className="fp-footer-heading" id={id}>
				{title}
			</h2>
			{children}
		</section>
	);
}

function Links({ links }: { links: readonly ContactLink[] }) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ul className="fp-footer-links" role="list">
			{links.map((link) => (
				<li key={`${link.kind}:${link.href}`}>
					<a href={link.href} rel={linkRel(link.href)}>
						{link.label}
					</a>
				</li>
			))}
		</ul>
	);
}

/**
 * Flash Parlour's footer, an ink-black shop sign: three stars, the studio's
 * name large in cream with its kind and the way to book (a mustard button,
 * which reads on the black where the red would not); then its pages, the
 * ways to reach it, where and when to visit and where to follow it, each a
 * column only when the studio's data has something for it; then the credit.
 * Ids are its own (`fp-footer-*`),
 * so the page's contact block can sit above it.
 */
export function FlashParlourFooter({
	studio,
	items,
	more,
	requestLink,
}: {
	studio: StudioView;
	items: readonly NavItem[];
	more: readonly NavItem[];
	requestLink: RequestLink | null;
}) {
	const { chat, follow, address } = contactGroups(studio);
	const visit = address !== null || studio.hours.length > 0;
	return (
		<footer className="fp-footer">
			<div className="fp-container fp-footer-inner">
				<div className="fp-footer-lead">
					<StarRow />
					<p className="fp-footer-name" dir="auto">
						{studio.name}
					</p>
					<p className="fp-footer-kind">{studio.typeLabel}</p>
					<BookingCta link={requestLink} className="fp-footer-cta" />
				</div>
				<div className="fp-footer-columns">
					<nav className="fp-footer-column" aria-labelledby="fp-footer-pages">
						<h2 className="fp-footer-heading" id="fp-footer-pages">
							{studioCopy.nav.explore}
						</h2>
						<NavList items={items} className="fp-footer-links" />
					</nav>
					{more.length > 0 ? (
						<nav className="fp-footer-column" aria-labelledby="fp-footer-more">
							<h2 className="fp-footer-heading" id="fp-footer-more">
								{studioCopy.nav.more}
							</h2>
							<NavList items={more} className="fp-footer-links" />
						</nav>
					) : null}
					{chat.length > 0 ? (
						<Column id="fp-footer-contact" title={studioCopy.nav.contact}>
							<Links links={chat} />
						</Column>
					) : null}
					{visit ? (
						<Column id="fp-footer-visit" title={studioCopy.nav.visit}>
							{address ? (
								<div className="fp-footer-address">
									<p className="user-text" dir="auto">
										{address.text}
									</p>
									<a
										className="fp-footer-map"
										href={address.mapsHref}
										rel={linkRel(address.mapsHref)}
									>
										<MapPin aria-hidden="true" />
										<span>{studioCopy.contact.map}</span>
									</a>
								</div>
							) : null}
							{studio.hours.length > 0 ? (
								<dl className="fp-footer-hours">
									<dt>{studioCopy.nav.hours}</dt>
									{studio.hours.map((line) => (
										<dd key={line.days}>
											<span>{line.days}</span>
											<span>{line.hours}</span>
										</dd>
									))}
								</dl>
							) : null}
						</Column>
					) : null}
					{follow.length > 0 ? (
						<Column id="fp-footer-follow" title={studioCopy.nav.follow}>
							<Links links={follow} />
						</Column>
					) : null}
				</div>
				<div className="fp-footer-legal">
					<p dir="auto">© {studio.name}</p>
					<p>{studioCopy.nav.credit}</p>
				</div>
			</div>
		</footer>
	);
}
