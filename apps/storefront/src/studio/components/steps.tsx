import { Fill } from "../../intake/components/fill.tsx";
import { studioCopy } from "../copy.ts";

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
