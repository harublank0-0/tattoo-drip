import type { ReactNode } from "react";
import { RequestInvite } from "../../components/inquiry.tsx";
import { BookingCta } from "../../components/storefront.tsx";
import { studioCopy } from "../../copy.ts";
import type { InquiryState } from "../../inquiry.ts";
import type { RequestLink } from "../../request.ts";

/**
 * The closing invitation on Irezumi's pages, on the raised paper band. With a
 * request link (the studio's, or a lone or named artist's while they take new
 * work) it is "Got an idea?" and that link; without one it is the shared
 * invitation (RequestInvite), which says the studio isn't taking inquiries
 * and links nowhere. Either way it carries the `inquiry` id.
 */
export function IrezumiInvite({
	state,
	link,
	line,
}: {
	state: InquiryState;
	link: RequestLink | null;
	/** The words under the title, when the page has its own. */
	line?: ReactNode;
}) {
	return (
		<div className="irz-band">
			<div className="irz-container irz-shared">
				{link ? (
					<section
						id="inquiry"
						className="section request-invite irz-invite"
						aria-labelledby="inquiry-title"
					>
						<h2 id="inquiry-title" className="section-title">
							{studioCopy.request.inviteTitle}
						</h2>
						{line ? <p className="measure">{line}</p> : null}
						<div className="actions">
							<BookingCta link={link} className="irz-cta" />
						</div>
					</section>
				) : (
					<RequestInvite state={state} />
				)}
			</div>
		</div>
	);
}
