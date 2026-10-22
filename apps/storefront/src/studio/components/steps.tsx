import { Fill } from "../../intake/components/fill.tsx";
import { studioCopy } from "../copy.ts";
import type { InquiryChannels } from "../inquiry.ts";
import { linkRel } from "../links.ts";

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
		<ol className="steps">
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

/** The compact strip: the four titles. `level` is the heading level under the page's outline. */
export function BookingStrip({
	studioName,
	level = 2,
}: {
	studioName: string;
	level?: 2 | 3;
}) {
	const Heading = level === 2 ? "h2" : "h3";
	return (
		<section className="steps-strip" aria-labelledby="steps-strip-title">
			<Heading id="steps-strip-title" className="steps-title">
				{studioCopy.booking.title}
			</Heading>
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
	const links: { href: string; label: string }[] = [];
	if (whatsapp) {
		links.push({
			href: whatsapp,
			label: studioCopy.booking.chatLinks.whatsapp,
		});
	}
	if (email) {
		links.push({ href: email, label: studioCopy.booking.chatLinks.email });
	}
	if (instagram) {
		links.push({
			href: instagram,
			label: studioCopy.booking.chatLinks.instagram,
		});
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
