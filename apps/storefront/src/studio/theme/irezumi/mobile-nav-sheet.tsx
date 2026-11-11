import { Sheet, SheetContent, SheetTitle } from "#/components/ui/sheet";
import { NavList } from "../../components/nav-list.tsx";
import { BookingCta, BrandIdentity } from "../../components/storefront.tsx";
import { studioCopy } from "../../copy.ts";
import type { NavItem } from "../../nav.ts";
import type { RequestLink } from "../../request.ts";
import type { StudioView } from "../../view-model.ts";
import type { ThemeConfig } from "../config.ts";

export interface IrezumiNavSheetProps {
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
 * The menu's sheet: a Radix dialog (shadcn's Sheet), so focus moves in, Escape
 * and a tap outside close it, and the page behind is inert. The studio's
 * name, the pages large in the display face, and the way to book at the
 * foot, a full-width button within a thumb's reach. Following a link closes
 * it and returns focus to the menu button.
 */
export default function IrezumiNavSheet({
	studio,
	theme,
	items,
	requestLink,
	open,
	onOpenChange,
	returnFocus,
}: IrezumiNavSheetProps) {
	const close = () => onOpenChange(false);
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				className="irz-sheet"
				aria-describedby={undefined}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					returnFocus();
				}}
			>
				<SheetTitle className="irz-sheet-title">
					<BrandIdentity studio={studio} theme={theme} />
				</SheetTitle>
				<nav aria-label={studioCopy.nav.label}>
					<NavList
						items={items}
						className="irz-sheet-list"
						onNavigate={close}
					/>
				</nav>
				<BookingCta
					link={requestLink}
					className="irz-sheet-cta"
					onNavigate={close}
				/>
			</SheetContent>
		</Sheet>
	);
}
