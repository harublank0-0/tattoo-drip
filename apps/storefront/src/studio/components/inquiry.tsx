import type { ReactNode } from "react";
import { Fill } from "../../intake/components/fill.tsx";
import { IntakeMount } from "../../intake/components/intake-mount.tsx";
import { studioCopy } from "../copy.ts";
import type { InquiryChannels, InquiryState } from "../inquiry.ts";
import { linkRel, requestHref } from "../links.ts";
import { BookingPanel, BookingStrip } from "./steps.tsx";

type OpenInquiry = Extract<InquiryState, { kind: "open" }>;

/**
 * The request page's section (TAT-48, TAT-127): open, it holds the intake
 * form (TAT-57), which mounts in the browser after hydration; on the server
 * and until then, and without JavaScript, <InquiryFallback>'s chat links
 * show. Closed, it says so. The section keeps its id (`inquiry`) and label
 * (`inquiry-title`) in every state; its heading, the page's `h1`, says
 * "Inquiries" while closed, so it doesn't invite above a refusal.
 *
 * Open (TAT-105), the section is the form's column with the compact "How
 * booking works" strip (an `h2`) under the heading on a phone, and the
 * sticky panel beside it from 60rem.
 *
 * `intro` (TAT-129) is what the request page shows right under the heading
 * and above the steps strip: the flash design asked for. Asking for a design
 * (`state.flashDesignId`) changes the heading to "Ask for this design".
 */
export function InquirySection({
	state,
	channels,
	challengeSiteKey = null,
	intro = null,
}: {
	state: InquiryState;
	channels: InquiryChannels;
	/** The public Turnstile site key (null: no bot check, development). */
	challengeSiteKey?: string | null;
	intro?: ReactNode;
}) {
	return (
		<div
			className={state.kind === "open" ? "section inquiry-split" : "section"}
		>
			<section id="inquiry" className="inquiry" aria-labelledby="inquiry-title">
				{/* An invitation only while the section offers one. */}
				<h1 id="inquiry-title" className="section-title">
					{state.kind === "open"
						? state.flashDesignId === undefined
							? studioCopy.sendIdea
							: studioCopy.flash.requestTitle
						: "Inquiries"}
				</h1>
				{intro}
				{state.kind === "open" ? (
					<BookingStrip studioName={state.studioName} />
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
							<Fill
								template={studioCopy.request.closedDescription}
								values={{ who: state.studioName }}
							/>
						</p>
					) : null}
					{state.kind === "artist-closed" ? (
						<>
							<p>
								<Fill
									template={studioCopy.request.closedDescription}
									values={{ who: state.artistName }}
								/>
							</p>
							{state.closedMessage ? (
								<p className="note user-text measure" dir="auto">
									{state.closedMessage}
								</p>
							) : null}
							{state.studioOpen ? (
								<a className="text-link" href={requestHref({})}>
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
 * The home page's #inquiry section (TAT-127): the form lives on /request, so
 * this is an invitation with one button there. It keeps the id the hero's old
 * link and every `/#inquiry` shared before it point at, so those links still
 * land one tap from the form. Open, it invites; in any other state it says
 * the studio isn't taking inquiries and links nowhere, so it never invites
 * above a refusal.
 */
export function RequestInvite({ state }: { state: InquiryState }) {
	const open = state.kind === "open";
	return (
		<section
			id="inquiry"
			className="section request-invite"
			aria-labelledby="inquiry-title"
		>
			<h2 id="inquiry-title" className="section-title">
				{open ? studioCopy.request.inviteTitle : "Inquiries"}
			</h2>
			{open ? (
				<div className="stack">
					<p className="measure">
						<Fill
							template={studioCopy.request.inviteLine}
							values={{ studio: state.studioName }}
						/>
					</p>
					<div className="actions">
						<a className="action action-primary" href={requestHref({})}>
							{studioCopy.sendIdea}
						</a>
					</div>
				</div>
			) : (
				<p className="measure">
					<Fill
						template={studioCopy.request.closedDescription}
						values={{ who: state.studioName }}
					/>
				</p>
			)}
		</section>
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
				{state.flashDesignId !== undefined && state.start ? (
					<>
						Ask <bdi>{state.studioName}</bdi> for <bdi>{state.start.idea}</bdi>:
						say where it goes and the dates that suit you.
					</>
				) : state.preferredArtist ? (
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
