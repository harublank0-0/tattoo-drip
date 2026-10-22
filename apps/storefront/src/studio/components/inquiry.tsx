import { IntakeMount } from "../../intake/components/intake-mount.tsx";
import type { InquiryChannels, InquiryState } from "../inquiry.ts";
import { linkRel } from "../links.ts";
import { BookingPanel, BookingStrip } from "./steps.tsx";

type OpenInquiry = Extract<InquiryState, { kind: "open" }>;

/**
 * The #inquiry section (TAT-48): open, it holds the intake form (TAT-57),
 * which mounts in the browser after hydration; on the server and until then,
 * and without JavaScript, <InquiryFallback>'s chat links show. Closed, it
 * says so. The section keeps its id (`inquiry`) and label (`inquiry-title`)
 * in every state; its heading says "Inquiries" while closed, so it doesn't
 * invite above a refusal.
 *
 * Open (TAT-105), the section is the form's column and "How booking works"
 * is a sticky panel beside it from 60rem (hidden below that). The artist's
 * page, whose hero has no steps of its own, shows the compact strip above its
 * form on a phone (`stripAbove`).
 */
export function InquirySection({
	state,
	channels,
	challengeSiteKey = null,
	stripAbove = false,
}: {
	state: InquiryState;
	channels: InquiryChannels;
	/** The public Turnstile site key (null: no bot check, development). */
	challengeSiteKey?: string | null;
	/** Show the four steps as a strip under the heading (on a phone). */
	stripAbove?: boolean;
}) {
	return (
		<div
			className={state.kind === "open" ? "section inquiry-split" : "section"}
		>
			<section id="inquiry" className="inquiry" aria-labelledby="inquiry-title">
				{/* An invitation only while the section offers one. */}
				<h2 id="inquiry-title" className="section-title">
					{state.kind === "open" ? "Send an inquiry" : "Inquiries"}
				</h2>
				{state.kind === "open" && stripAbove ? (
					<BookingStrip studioName={state.studioName} level={3} />
				) : null}
				<div className="stack measure">
					{state.kind === "open" ? (
						<IntakeMount
							state={state}
							channels={channels}
							challengeSiteKey={challengeSiteKey}
							fallback={<InquiryFallback state={state} channels={channels} />}
						/>
					) : null}
					{state.kind === "studio-closed" ? (
						<p>
							<bdi>{state.studioName}</bdi> isn't taking new inquiries right
							now.
						</p>
					) : null}
					{state.kind === "artist-closed" ? (
						<>
							<p>
								<bdi>{state.artistName}</bdi> isn't taking new inquiries right
								now.
							</p>
							{state.studioOpen ? (
								<a className="text-link" href="/#inquiry">
									<span>
										Send <bdi>{state.studioName}</bdi> a general inquiry
									</span>
								</a>
							) : null}
						</>
					) : null}
				</div>
			</section>
			{state.kind === "open" ? (
				<BookingPanel studioName={state.studioName} channels={channels} />
			) : null}
		</div>
	);
}

/**
 * The open section on the server, before hydration and without JavaScript:
 * the inquiry goes by WhatsApp or email with a prefilled message, else by
 * Instagram. The intake form replaces it in the browser.
 */
function InquiryFallback({
	state,
	channels,
}: {
	state: OpenInquiry;
	channels: InquiryChannels;
}) {
	const { whatsapp, email, instagram } = channels;
	if (!whatsapp && !email && !instagram) {
		return (
			<p>
				<bdi>{state.studioName}</bdi> hasn't added contact details yet.
			</p>
		);
	}
	return (
		<>
			<p>
				{state.preferredArtist ? (
					<>
						Send <bdi>{state.studioName}</bdi> your idea for{" "}
						<bdi>{state.preferredArtist.name}</bdi>: the placement and size, and
						the dates that suit you.
					</>
				) : (
					<>
						Send <bdi>{state.studioName}</bdi> your idea, the placement and
						size, and the dates that suit you.
					</>
				)}
			</p>
			<div className="actions">
				{whatsapp ? (
					<a
						className="action action-primary"
						href={whatsapp}
						rel={linkRel(whatsapp)}
					>
						Message on WhatsApp
					</a>
				) : null}
				{email ? (
					<a
						className={
							whatsapp ? "action action-secondary" : "action action-primary"
						}
						href={email}
					>
						Send an email
					</a>
				) : null}
				{instagram ? (
					<a
						className="action action-primary"
						href={instagram}
						rel={linkRel(instagram)}
					>
						Message on Instagram
					</a>
				) : null}
			</div>
		</>
	);
}
