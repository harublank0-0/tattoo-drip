import { Fill } from "../../../../intake/components/fill.tsx";
import { RouterAnchor } from "../../../components/router-anchor.tsx";
import { BookingCta } from "../../../components/storefront.tsx";
import { studioCopy } from "../../../copy.ts";
import type { InquiryState } from "../../../inquiry.ts";
import { workHref } from "../../../links.ts";
import type { RequestLink } from "../../../request.ts";
import { inkNoirHomeCopy } from "./copy.ts";
import { Lines } from "./parts.tsx";

const copy = inkNoirHomeCopy.cta;

/**
 * The close of the page: the invitation to /request (the `inquiry` section,
 * which a studio can't hide, so its id keeps every `/#inquiry` link landing
 * one tap from the form). Open, it invites in large type, walks through how
 * booking works (the same four steps as everywhere: they are a sequence, so
 * they are numbered) and offers the Request button, `requestLink` as in the
 * header. Closed, it says so and links nowhere that would refuse; the way on
 * is the work or the artists.
 */
export function FinalBookingCta({
	state,
	requestLink,
	artistsShown,
}: {
	state: InquiryState;
	requestLink: RequestLink | null;
	/** Whether the page shows the artists, so "Explore the artists" lands somewhere. */
	artistsShown: boolean;
}) {
	const open = state.kind === "open" && requestLink !== null;
	const explore = artistsShown ? (
		<RouterAnchor className="action ink-action-quiet" href="#artists">
			{copy.exploreArtists}
		</RouterAnchor>
	) : (
		<RouterAnchor className="action ink-action-quiet" href={workHref({})}>
			{copy.exploreWork}
		</RouterAnchor>
	);
	return (
		<section
			id="inquiry"
			className={
				open
					? "ink-section ink-close"
					: "ink-section ink-close ink-close-closed"
			}
			aria-labelledby="inquiry-title"
		>
			<div className="ink-container ink-close-grid">
				<p className="ink-label">{open ? copy.eyebrow : copy.closedEyebrow}</p>
				<h2 id="inquiry-title" className="ink-close-title">
					<Lines lines={open ? copy.lines : copy.closedLines} />
				</h2>
				<div className="ink-close-body">
					{open ? (
						<>
							<p className="ink-close-line">{copy.line}</p>
							<p className="ink-close-detail">
								<Fill
									template={studioCopy.request.inviteLine}
									values={{ studio: state.studioName }}
								/>
							</p>
							{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
							<ol
								className="ink-steps"
								// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
								role="list"
								aria-label={studioCopy.booking.title}
							>
								{studioCopy.booking.steps.map((step) => (
									<li key={step.title}>{step.title}</li>
								))}
							</ol>
						</>
					) : (
						<p className="ink-close-line">
							<Fill
								template={studioCopy.request.closedDescription}
								values={{ who: state.studioName }}
							/>
						</p>
					)}
					<div className="ink-close-actions">
						{open ? (
							<BookingCta link={requestLink} className="ink-cta" />
						) : null}
						{explore}
					</div>
				</div>
			</div>
		</section>
	);
}
