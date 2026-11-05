import { Sheet, SheetContent, SheetTitle } from "#/components/ui/sheet";
import { BookingCta, BrandIdentity } from "../../components/storefront.tsx";
import { studioCopy } from "../../copy.ts";
import type { NavItem } from "../../nav.ts";
import type { RequestLink } from "../../request.ts";
import type { StudioView } from "../../view-model.ts";
import type { ThemeConfig } from "../config.ts";
import { NavList } from "./nav-list.tsx";

export interface MobileNavSheetProps {
	readonly studio: StudioView;
	readonly theme: ThemeConfig;
	readonly items: readonly NavItem[];
	readonly requestLink: RequestLink | null;
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	/** Where focus goes when the sheet closes: the menu's button. */
	readonly returnFocus: () => void;
}

/**
 * The menu's sheet: a Radix dialog (shadcn's Sheet), so focus moves into it,
 * Escape and a tap outside close it, and the page behind is inert and does
 * not scroll. It names the studio, lists the pages, and ends with the way to
 * book; following a link closes it. Its own chunk (MobileNav loads it on the
 * first sign someone wants the menu), so a page that never opens it never
 * downloads Radix. The button that opens it is MobileNav's, outside Radix,
 * so focus is returned to it here.
 */
export default function MobileNavSheet({
	studio,
	theme,
	items,
	requestLink,
	open,
	onOpenChange,
	returnFocus,
}: MobileNavSheetProps) {
	const close = () => onOpenChange(false);
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				className="ink-sheet"
				// The title and the links say it all; there is no description.
				aria-describedby={undefined}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					returnFocus();
				}}
			>
				<SheetTitle className="ink-sheet-title">
					<BrandIdentity studio={studio} theme={theme} />
				</SheetTitle>
				<nav aria-label={studioCopy.nav.label}>
					<NavList
						items={items}
						className="ink-sheet-list"
						onNavigate={close}
					/>
				</nav>
				<BookingCta
					link={requestLink}
					className="ink-sheet-cta"
					onNavigate={close}
				/>
			</SheetContent>
		</Sheet>
	);
}
