import { SocialIcon } from "@tattoo-drip/react/social-icon";
import { studioCopy } from "../copy.ts";
import { isAllowedHref, linkRel } from "../links.ts";
import type {
	ContactLink,
	ContactLinkKind,
	StudioView,
} from "../view-model.ts";

/**
 * The studio's links and street address (TAT-48), grouped for a client
 * (TAT-105): Chat (WhatsApp, Viber, call, email), Follow (Instagram,
 * Facebook, TikTok, website, other places) and Visit (the street address and
 * its map). A group with nothing in it is left out; nothing at all when the
 * studio has set none. Every href comes from the view model and is checked
 * once more here.
 */

const CHAT_KINDS: ReadonlySet<ContactLinkKind> = new Set([
	"whatsapp",
	"viber",
	"call",
	"email",
]);

function LinkGroup({
	id,
	label,
	links,
}: {
	id: string;
	label: string;
	links: readonly ContactLink[];
}) {
	if (links.length === 0) return null;
	return (
		<div className="contact-group">
			<p className="contact-label" id={id}>
				{label}
			</p>
			<ul className="links" aria-labelledby={id}>
				{links.map((link) => (
					<li key={`${link.kind}:${link.href}`}>
						<a className="link-chip" href={link.href} rel={linkRel(link.href)}>
							<SocialIcon platform={link.kind} className="social-link-icon" />
							{link.label}
						</a>
					</li>
				))}
			</ul>
		</div>
	);
}

/** The studio's links and address as a client looks for them, every href checked once more. */
export interface ContactGroups {
	/** WhatsApp, Viber, call and email. */
	readonly chat: readonly ContactLink[];
	/** Instagram, Facebook, TikTok, the website and other places. */
	readonly follow: readonly ContactLink[];
	readonly address: StudioView["address"];
}

/** The Chat, Follow and Visit groups (TAT-105): the contact block's, and a theme footer's. */
export function contactGroups(studio: StudioView): ContactGroups {
	const links = studio.links.filter((link) => isAllowedHref(link.href));
	return {
		chat: links.filter((link) => CHAT_KINDS.has(link.kind)),
		follow: links.filter((link) => !CHAT_KINDS.has(link.kind)),
		address:
			studio.address && isAllowedHref(studio.address.mapsHref)
				? studio.address
				: null,
	};
}

export function ContactBlock({ studio }: { studio: StudioView }) {
	const { chat, follow, address } = contactGroups(studio);
	if (chat.length === 0 && follow.length === 0 && !address) return null;
	return (
		<address className="contact">
			<LinkGroup
				id="contact-chat"
				label={studioCopy.contact.chat}
				links={chat}
			/>
			<LinkGroup
				id="contact-follow"
				label={studioCopy.contact.follow}
				links={follow}
			/>
			{address ? (
				<div className="contact-group">
					<p className="contact-label" id="contact-visit">
						{studioCopy.contact.visit}
					</p>
					<div className="street">
						<p className="user-text" dir="auto">
							{address.text}
						</p>
						<a
							className="text-link"
							href={address.mapsHref}
							rel={linkRel(address.mapsHref)}
						>
							{studioCopy.contact.map}
						</a>
					</div>
				</div>
			) : null}
		</address>
	);
}
