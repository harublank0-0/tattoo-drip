import { FlashSummary } from "../../../components/flash.tsx";
import { InquirySection } from "../../../components/inquiry.tsx";
import type { Shell } from "../../../components/shell.tsx";
import type { RequestPageData } from "../../../loaders.ts";
import { challengeThemeFor } from "../../branding.ts";
import { Lines } from "../home/parts.tsx";
import { InkNoirShell } from "../shell.tsx";

/** Ink Noir's booking page words: editorial lines only, nothing about a studio. */
const copy = {
	label: "Book a session",
	open: {
		lines: ["Let's create", "something permanent."],
		lede: "Every great tattoo begins with a conversation. Tell us what you have in mind.",
	},
	closed: {
		lines: ["Requests"],
		lede: null,
	},
} as const;

/**
 * Ink Noir's booking page (`/book`, Prompt 6): an editorial opening (the
 * page's one h1, `inquiry-title`, which the flow's form is named by) over the
 * shared booking flow, which brings its own progress and running summary.
 * While nobody takes new work the opening invites nothing and the section
 * says so. The flow, its rules and its data are every theme's
 * (InquirySection, src/booking/); only the opening and the look are Ink
 * Noir's (book.css).
 */
export function InkNoirBookPage({
	data,
	challengeSiteKey = null,
	Shell = InkNoirShell,
}: {
	data: RequestPageData;
	challengeSiteKey?: string | null;
	Shell?: Shell;
}) {
	const { studio, theme, inquiry, channels } = data;
	const words = inquiry.kind === "open" ? copy.open : copy.closed;
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={null}
			chat={data.chat}
			page="request"
			artistsShown={data.hasArtists}
			mainClassName="ink-home ink-book-page"
		>
			<header className="ink-book-hero">
				<div className="ink-container">
					<p className="ink-label">{copy.label}</p>
					<h1 id="inquiry-title" className="ink-book-title">
						<Lines lines={words.lines} />
					</h1>
					{words.lede ? <p className="ink-book-lede">{words.lede}</p> : null}
				</div>
			</header>
			<div className="ink-container ink-book-body">
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
