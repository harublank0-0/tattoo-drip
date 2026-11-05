import { ChatButton } from "../../components/chat.tsx";
import type { ShellProps } from "../../components/shell.tsx";
import { studioCopy } from "../../copy.ts";
import { moreNavItems, navItems } from "../../nav.ts";
import { InkNoirFooter } from "./footer.tsx";
import { InkNoirHeader } from "./header.tsx";

/**
 * Ink Noir's shell: a skip link to the content, the header with the site's
 * navigation, the page in `<main id="main">`, the footer and the chat
 * button. The page's own content (the same components every theme renders)
 * goes in `<main>`; `tabIndex={-1}` lets the skip link move focus there.
 */
export function InkNoirShell({
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
			<a className="ink-skip" href="#main">
				{studioCopy.nav.skip}
			</a>
			<InkNoirHeader
				studio={studio}
				theme={theme}
				items={items}
				requestLink={requestLink}
			/>
			<main id="main" tabIndex={-1} className={mainClassName}>
				{children}
			</main>
			<InkNoirFooter
				studio={studio}
				items={items}
				more={more}
				requestLink={requestLink}
			/>
			<ChatButton chat={chat} studioName={studio.name} />
		</>
	);
}
