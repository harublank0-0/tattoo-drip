import { MessageCircle } from "lucide-react";
import { fill } from "../../intake/template.ts";
import type { ChatLinks } from "../chat.ts";
import { studioCopy } from "../copy.ts";
import { isAllowedHref, linkRel } from "../links.ts";

/**
 * The chat button (TAT-127): a corner toggle on the studio, artist, work and
 * request pages that opens WhatsApp and Viber. It is the browser's own
 * `<details>`, so it opens and closes without JavaScript (and without state
 * or focus code in a component): the toggle is the `<summary>`, the two links
 * a list that opens above it. Nothing at all without a valid phone (`chat` is
 * null), and each href is checked once more here, like the hero's.
 */
export function ChatButton({
	chat,
	studioName,
}: {
	chat: ChatLinks | null;
	studioName: string;
}) {
	if (!chat) return null;
	const links = [
		{ href: chat.whatsapp, label: studioCopy.chat.whatsapp },
		{ href: chat.viber, label: studioCopy.chat.viber },
	].filter((link) => isAllowedHref(link.href));
	if (links.length === 0) return null;
	const list = (
		// list-style: none drops the list semantics in WebKit (VoiceOver stops
		// saying "list, 2 items"); the explicit role puts them back.
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ul className="chat-float-links" role="list">
			{links.map((link) => (
				<li key={link.href}>
					<a
						className="action action-secondary"
						href={link.href}
						rel={linkRel(link.href)}
					>
						{link.label}
					</a>
				</li>
			))}
		</ul>
	);
	return (
		<aside
			className="chat-float"
			aria-label={fill(studioCopy.chat.label, { studio: studioName })}
		>
			<details>
				<summary className="action action-primary chat-float-toggle">
					<MessageCircle aria-hidden="true" />
					<span>{studioCopy.chat.toggle}</span>
				</summary>
				{list}
			</details>
		</aside>
	);
}
