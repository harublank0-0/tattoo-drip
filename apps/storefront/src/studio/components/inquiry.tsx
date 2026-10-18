import type { InquiryChannels, InquiryState } from "../inquiry.ts";
import { linkRel } from "../links.ts";

type OpenInquiry = Extract<InquiryState, { kind: "open" }>;

/**
 * The #inquiry section (TAT-48): the intake form's mount point. TAT-57
 * renders its form in place of <InquiryFallback> (the `open` branch), with
 * `state.preferredArtist` pre-selected and only `state.artists` to choose
 * from, and keeps the closed branches as they are.
 */
export function InquirySection({
	state,
	channels,
}: {
	state: InquiryState;
	channels: InquiryChannels;
}) {
	return (
		<section id="inquiry" className="section" aria-labelledby="inquiry-title">
			<h2 id="inquiry-title" className="section-title">
				Send an inquiry
			</h2>
			<div className="stack measure">
				{state.kind === "open" ? (
					<InquiryFallback state={state} channels={channels} />
				) : null}
				{state.kind === "studio-closed" ? (
					<p>
						<bdi>{state.studioName}</bdi> isn't taking new inquiries right now.
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
	);
}

/**
 * Until TAT-57's form: the inquiry goes by WhatsApp or email with a
 * prefilled message, else by Instagram.
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
