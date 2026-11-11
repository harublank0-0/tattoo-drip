import { FlashSummary } from "../../components/flash.tsx";
import { InquirySection } from "../../components/inquiry.tsx";
import type { Shell } from "../../components/shell.tsx";
import type { RequestPageData } from "../../loaders.ts";
import { atelierCopy } from "./copy.ts";
import { AtelierShell } from "./shell.tsx";

const copy = atelierCopy.book;

/**
 * Atelier's booking page (`/book`): a quiet opening (the page's one h1,
 * `inquiry-title`, which names the flow's form) over the shared booking flow,
 * unchanged: its steps, rules, data and Turnstile are every theme's
 * (InquirySection); only the opening and the paper are Atelier's. While
 * nobody takes new work the opening invites nothing and the section says so.
 */
export function AtelierBookPage({
	data,
	challengeSiteKey = null,
	Shell = AtelierShell,
}: {
	data: RequestPageData;
	challengeSiteKey?: string | null;
	Shell?: Shell;
}) {
	const { studio, theme, inquiry, channels } = data;
	const open = inquiry.kind === "open";
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={null}
			chat={data.chat}
			page="request"
			artistsShown={data.hasArtists}
			mainClassName="atl-main atl-book"
		>
			<header className="atl-page-head">
				<div className="atl-container">
					<p className="atl-kicker">{copy.label}</p>
					<h1 id="inquiry-title" className="atl-page-title">
						{open ? copy.open : copy.closed}
					</h1>
					{open ? <p className="atl-page-line">{copy.openLine}</p> : null}
				</div>
			</header>
			<div className="atl-container atl-book-body">
				<InquirySection
					state={inquiry}
					channels={channels}
					challengeSiteKey={challengeSiteKey}
					booking={data.booking}
					headed={false}
					intro={
						data.flash ? (
							<FlashSummary request={data.flash} studioName={studio.name} />
						) : null
					}
				/>
			</div>
		</Shell>
	);
}
