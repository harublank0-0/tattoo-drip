import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { ReactNode } from "react";
import { contactGroups } from "../../components/contact.tsx";
import { NavList } from "../../components/nav-list.tsx";
import { BookingCta } from "../../components/storefront.tsx";
import { studioCopy } from "../../copy.ts";
import { linkRel } from "../../links.ts";
import type { NavItem } from "../../nav.ts";
import type { RequestLink } from "../../request.ts";
import type {
	ContactLink,
	ContactLinkKind,
	StudioView,
} from "../../view-model.ts";

const CHAT_ICONS: Partial<Record<ContactLinkKind, typeof Phone>> = {
	whatsapp: MessageCircle,
	viber: MessageCircle,
	call: Phone,
	email: Mail,
};

/** One titled column of the footer; nothing when it has nothing in it. */
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
		<section className="ink-footer-column" aria-labelledby={id}>
			<h2 className="ink-footer-heading" id={id}>
				{title}
			</h2>
			{children}
		</section>
	);
}

function LinkList({
	links,
	icons,
}: {
	links: readonly ContactLink[];
	icons: boolean;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ul className="ink-footer-links" role="list">
			{links.map((link) => {
				const Icon = icons ? CHAT_ICONS[link.kind] : undefined;
				return (
					<li key={`${link.kind}:${link.href}`}>
						<a href={link.href} rel={linkRel(link.href)}>
							{Icon ? <Icon aria-hidden="true" /> : null}
							<span>{link.label}</span>
						</a>
					</li>
				);
			})}
		</ul>
	);
}

/**
 * Ink Noir's footer: the studio's name set large as its signature, what kind
 * of studio it is and the way to book; then the pages, the ways to reach it,
 * where it is and when it is open, and where to follow it; then the line that
 * says who runs the page. Everything comes from the studio's own data
 * (StudioView, its links checked once more by contactGroups); a column with
 * nothing in it is left out, so a studio that set little gets a short footer,
 * never an empty heading. Its ids are its own: the page's contact block
 * (contact-*) can sit above it.
 */
export function InkNoirFooter({
	studio,
	items,
	more = [],
	requestLink,
}: {
	studio: StudioView;
	items: readonly NavItem[];
	/** The further pages: FAQ, Policies, Aftercare (Prompt 7). */
	more?: readonly NavItem[];
	requestLink: RequestLink | null;
}) {
	const { chat, follow, address } = contactGroups(studio);
	const visit = address !== null || studio.hours.length > 0;
	return (
		<footer className="ink-footer">
			<div className="ink-container ink-footer-inner">
				<div className="ink-footer-lead">
					<p className="ink-footer-name" dir="auto">
						{studio.name}
					</p>
					<p className="ink-footer-about">{studio.typeLabel}</p>
					<BookingCta link={requestLink} className="ink-footer-cta" />
				</div>
				<div className="ink-footer-columns">
					<nav
						className="ink-footer-column"
						aria-labelledby="ink-footer-explore"
					>
						<h2 className="ink-footer-heading" id="ink-footer-explore">
							{studioCopy.nav.explore}
						</h2>
						<NavList items={items} className="ink-footer-links" />
					</nav>
					{more.length > 0 ? (
						<nav
							className="ink-footer-column"
							aria-labelledby="ink-footer-more"
						>
							<h2 className="ink-footer-heading" id="ink-footer-more">
								{studioCopy.nav.more}
							</h2>
							<NavList items={more} className="ink-footer-links" />
						</nav>
					) : null}
					{chat.length > 0 ? (
						<Column id="ink-footer-contact" title={studioCopy.nav.contact}>
							<LinkList links={chat} icons />
						</Column>
					) : null}
					{visit ? (
						<Column id="ink-footer-visit" title={studioCopy.nav.visit}>
							{address ? (
								<div className="ink-footer-address">
									<p className="user-text" dir="auto">
										{address.text}
									</p>
									<a
										className="ink-footer-map"
										href={address.mapsHref}
										rel={linkRel(address.mapsHref)}
									>
										<MapPin aria-hidden="true" />
										<span>{studioCopy.contact.map}</span>
									</a>
								</div>
							) : null}
							{studio.hours.length > 0 ? (
								<dl className="ink-footer-hours">
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
						<Column id="ink-footer-follow" title={studioCopy.nav.follow}>
							<LinkList links={follow} icons={false} />
						</Column>
					) : null}
				</div>
				<div className="ink-footer-legal">
					<p dir="auto">© {studio.name}</p>
					<p>{studioCopy.nav.credit}</p>
				</div>
			</div>
		</footer>
	);
}
