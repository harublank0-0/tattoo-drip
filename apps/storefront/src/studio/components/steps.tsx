import { Fill } from "../../intake/components/fill.tsx";
import { studioCopy } from "../copy.ts";
import type { InquiryChannels } from "../inquiry.ts";
import { isAllowedHref, linkRel } from "../links.ts";

/**
 * "How booking works" (TAT-105), once for a phone and once for a desktop:
 * the strip sits under the hero's buttons (or above the artist page's form)
 * and is hidden from 60rem, the panel sits beside the form, sticky, and is
 * hidden below 60rem. Each is `display: none` where it doesn't apply, so a
 * screen reader reads the four steps once.
 */

function Steps({
	studioName,
	detailed,
}: {
	studioName: string;
	detailed: boolean;
}) {
	return (
		// list-style: none drops the list semantics in WebKit (VoiceOver stops
		// saying "list, 4 items"); the explicit role puts them back.
		// biome-ignore lint/a11y/useSemanticElements: it is an <ol>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ol className="steps" role="list">
			{studioCopy.booking.steps.map((step) => (
				<li key={step.title} className="step">
					<span className="step-title">{step.title}</span>
					{detailed ? (
						<span className="step-detail">
							<Fill template={step.detail} values={{ studio: studioName }} />
						</span>
					) : null}
				</li>
			))}
		</ol>
	);
}

/** The compact strip: the four titles under an `h2`. */
export function BookingStrip({ studioName }: { studioName: string }) {
	return (
		<section className="steps-strip" aria-labelledby="steps-strip-title">
			<h2 id="steps-strip-title" className="steps-title">
				{studioCopy.booking.title}
			</h2>
			<Steps studioName={studioName} detailed={false} />
		</section>
	);
}

/** The sticky panel beside the form: the four steps with a line each, and the chat links. */
export function BookingPanel({
	studioName,
	channels,
}: {
	studioName: string;
	channels: InquiryChannels;
}) {
	const { whatsapp, email, instagram } = channels;
	// Every href is checked once more here, like the hero's and the contacts'.
	const links: { href: string; label: string }[] = [];
	for (const [href, label] of [
		[whatsapp, studioCopy.booking.chatLinks.whatsapp],
		[email, studioCopy.booking.chatLinks.email],
		[instagram, studioCopy.booking.chatLinks.instagram],
	] as const) {
		if (href && isAllowedHref(href)) links.push({ href, label });
	}
	return (
		<aside className="inquiry-aside" aria-labelledby="steps-panel-title">
			<h2 id="steps-panel-title" className="steps-title">
				{studioCopy.booking.title}
			</h2>
			<Steps studioName={studioName} detailed />
			{links.length > 0 ? (
				<p className="steps-chat">
					{studioCopy.booking.chat}
					<span className="steps-chat-links">
						{links.map((link) => (
							<a
								key={link.href}
								className="text-link"
								href={link.href}
								rel={linkRel(link.href)}
							>
								{link.label}
							</a>
						))}
					</span>
				</p>
			) : null}
		</aside>
	);
}
