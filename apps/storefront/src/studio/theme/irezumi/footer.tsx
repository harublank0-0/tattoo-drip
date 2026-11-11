import { MapPin } from "lucide-react";
import type { ReactNode } from "react";
import { contactGroups } from "../../components/contact.tsx";
import { BookingCta } from "../../components/storefront.tsx";
import { studioCopy } from "../../copy.ts";
import { linkRel } from "../../links.ts";
import type { NavItem } from "../../nav.ts";
import type { RequestLink } from "../../request.ts";
import type { ContactLink, StudioView } from "../../view-model.ts";
import { NavList } from "../ink-noir/nav-list.tsx";

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
		<section className="irz-footer-column" aria-labelledby={id}>
			<h2 className="irz-footer-heading" id={id}>
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
		<ul className="irz-footer-links" role="list">
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
 * Irezumi's footer, on the raised paper: the studio's name with its kind and
 * the way to book; then its pages, the ways to reach it, where and when to
 * visit and where to follow it, each a column only when the studio's data
 * has something for it; then the credit. Ids are its own (`irz-footer-*`),
 * so the page's contact block can sit above it.
 */
export function IrezumiFooter({
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
		<footer className="irz-footer">
			<div className="irz-container irz-footer-inner">
				<div className="irz-footer-lead">
					<p className="irz-footer-name" dir="auto">
						{studio.name}
					</p>
					<p className="irz-footer-kind">{studio.typeLabel}</p>
					<BookingCta link={requestLink} className="irz-footer-cta" />
				</div>
				<div className="irz-footer-columns">
					<nav className="irz-footer-column" aria-labelledby="irz-footer-pages">
						<h2 className="irz-footer-heading" id="irz-footer-pages">
							{studioCopy.nav.explore}
						</h2>
						<NavList items={items} className="irz-footer-links" />
					</nav>
					{more.length > 0 ? (
						<nav
							className="irz-footer-column"
							aria-labelledby="irz-footer-more"
						>
							<h2 className="irz-footer-heading" id="irz-footer-more">
								{studioCopy.nav.more}
							</h2>
							<NavList items={more} className="irz-footer-links" />
						</nav>
					) : null}
					{chat.length > 0 ? (
						<Column id="irz-footer-contact" title={studioCopy.nav.contact}>
							<Links links={chat} />
						</Column>
					) : null}
					{visit ? (
						<Column id="irz-footer-visit" title={studioCopy.nav.visit}>
							{address ? (
								<div className="irz-footer-address">
									<p className="user-text" dir="auto">
										{address.text}
									</p>
									<a
										className="irz-footer-map"
										href={address.mapsHref}
										rel={linkRel(address.mapsHref)}
									>
										<MapPin aria-hidden="true" />
										<span>{studioCopy.contact.map}</span>
									</a>
								</div>
							) : null}
							{studio.hours.length > 0 ? (
								<dl className="irz-footer-hours">
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
						<Column id="irz-footer-follow" title={studioCopy.nav.follow}>
							<Links links={follow} />
						</Column>
					) : null}
				</div>
				<div className="irz-footer-legal">
					<p dir="auto">© {studio.name}</p>
					<p>{studioCopy.nav.credit}</p>
				</div>
			</div>
		</footer>
	);
}
