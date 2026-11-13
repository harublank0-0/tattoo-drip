import { FlashSummary } from "../../components/flash.tsx";
import { InquirySection } from "../../components/inquiry.tsx";
import type { Shell } from "../../components/shell.tsx";
import type { RequestPageData } from "../../loaders.ts";
import { challengeThemeFor } from "../branding.ts";
import { flashParlourCopy } from "./copy.ts";
import { PageHead } from "./page-head.tsx";
import { FlashParlourShell } from "./shell.tsx";

const copy = flashParlourCopy.book;

/**
 * Flash Parlour's booking page (`/book`): a loud opening (the page's one h1,
 * `inquiry-title`, which names the flow's form) over the shared booking flow,
 * unchanged: its steps, rules, data and Turnstile are every theme's
 * (InquirySection); only the opening and the cream are Flash Parlour's. While
 * nobody takes new work the opening invites nothing and the section says so.
 * The opening speaks of the flash wall only while the studio shows Flash and
 * has a design on it (`hasFlash`).
 */
export function FlashParlourBookPage({
	data,
	challengeSiteKey = null,
	Shell = FlashParlourShell,
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
			mainClassName="fp-main fp-book"
		>
			<PageHead
				label={copy.label}
				title={open ? copy.open : copy.closed}
				titleId="inquiry-title"
				line={
					open
						? data.hasFlash
							? copy.openLineFlash
							: copy.openLine
						: undefined
				}
			/>
			<div className="fp-container fp-book-body">
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
