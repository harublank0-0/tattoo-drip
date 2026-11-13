import { ChatButton } from "../../components/chat.tsx";
import type { ShellProps } from "../../components/shell.tsx";
import { studioCopy } from "../../copy.ts";
import { moreNavItems, navItems } from "../../nav.ts";
import { FlashParlourFooter } from "./footer.tsx";
import { FlashParlourHeader } from "./header.tsx";

/**
 * Flash Parlour's shell: a skip link to the content, the header with the site's
 * navigation and the way to book, the page in `<main id="main">`, the
 * footer and the chat button. The same props every theme's shell takes;
 * what is current comes from the page, never from the address.
 */
export function FlashParlourShell({
	studio,
	theme,
	requestLink,
	chat,
	page,
	artistsShown,
	mainClassName = "page",
	children,
}: ShellProps) {
	const items = navItems(theme.sections, page, artistsShown, studio.pages);
	const more = moreNavItems(theme.sections, page, studio.pages);
	return (
		<>
			<a className="fp-skip" href="#main">
				{studioCopy.nav.skip}
			</a>
			<FlashParlourHeader
				studio={studio}
				theme={theme}
				items={items}
				requestLink={requestLink}
			/>
			<main id="main" tabIndex={-1} className={mainClassName}>
				{children}
			</main>
			<FlashParlourFooter
				studio={studio}
				items={items}
				more={more}
				requestLink={requestLink}
			/>
			<ChatButton chat={chat} studioName={studio.name} />
		</>
	);
}
