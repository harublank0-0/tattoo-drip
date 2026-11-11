import { FlashSummary } from "../../components/flash.tsx";
import { InquirySection } from "../../components/inquiry.tsx";
import type { Shell } from "../../components/shell.tsx";
import type { RequestPageData } from "../../loaders.ts";
import { challengeThemeFor } from "../branding.ts";
import { irezumiCopy } from "./copy.ts";
import { IrezumiShell } from "./shell.tsx";

const copy = irezumiCopy.book;

/**
 * Irezumi's booking page (`/book`): a quiet opening (the page's one h1,
 * `inquiry-title`, which names the flow's form) over the shared booking flow,
 * unchanged: its steps, rules, data and Turnstile are every theme's
 * (InquirySection); only the opening and the paper are Irezumi's. While
 * nobody takes new work the opening invites nothing and the section says so.
 */
export function IrezumiBookPage({
	data,
	challengeSiteKey = null,
	Shell = IrezumiShell,
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
			mainClassName="irz-main irz-book"
		>
			<header className="irz-page-head">
				<div className="irz-container">
					<p className="irz-kicker">{copy.label}</p>
					<h1 id="inquiry-title" className="irz-page-title">
						{open ? copy.open : copy.closed}
					</h1>
					{open ? <p className="irz-page-line">{copy.openLine}</p> : null}
				</div>
			</header>
			<div className="irz-container irz-book-body">
				<InquirySection
					state={inquiry}
					channels={channels}
					challengeSiteKey={challengeSiteKey}
					challengeTheme={challengeThemeFor(theme.key)}
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
