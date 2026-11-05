import { Menu } from "lucide-react";
import { type ComponentType, lazy, Suspense, useRef, useState } from "react";
import { studioCopy } from "../../copy.ts";
import type { NavItem } from "../../nav.ts";
import type { RequestLink } from "../../request.ts";
import type { StudioView } from "../../view-model.ts";
import type { ThemeConfig } from "../config.ts";
import type { MobileNavSheetProps } from "./mobile-nav-sheet.tsx";

/** The sheet's chunk (Radix's dialog): loaded on the first sign someone wants the menu. */
const loadSheet = () => import("./mobile-nav-sheet.tsx");

/**
 * A chunk that fails to load (the phone went offline) must not take the page
 * down with it through the route's error boundary: the menu then stays shut,
 * and the footer's Explore list still has every page.
 */
const MobileNavSheet = lazy<ComponentType<MobileNavSheetProps>>(() =>
	loadSheet().catch(() => ({ default: NoSheet })),
);

function NoSheet(_: MobileNavSheetProps) {
	return null;
}

/**
 * The phone's menu (below 60rem): a button in the header that opens the
 * navigation in a sheet from the side (mobile-nav-sheet.tsx). The server
 * renders only the button, closed; the sheet's code is fetched when a
 * pointer comes over the button, it takes focus or is pressed, and the sheet
 * is mounted on the first tap and kept after (for its closing animation, and
 * no second load). Without JavaScript the button does nothing, and the
 * footer's Explore list carries the same links.
 */
export function MobileNav({
	studio,
	theme,
	items,
	requestLink,
}: {
	studio: StudioView;
	theme: ThemeConfig;
	items: readonly NavItem[];
	requestLink: RequestLink | null;
}) {
	const [open, setOpen] = useState(false);
	const [mounted, setMounted] = useState(false);
	const button = useRef<HTMLButtonElement>(null);
	const preload = () => {
		void loadSheet().catch(() => undefined);
	};
	return (
		<>
			<button
				ref={button}
				type="button"
				className="ink-menu-button"
				aria-haspopup="dialog"
				aria-expanded={open}
				onPointerEnter={preload}
				onPointerDown={preload}
				onFocus={preload}
				onClick={() => {
					setMounted(true);
					setOpen(true);
				}}
			>
				<Menu aria-hidden="true" />
				<span className="sr-only">{studioCopy.nav.menu}</span>
			</button>
			{mounted ? (
				<Suspense fallback={null}>
					<MobileNavSheet
						studio={studio}
						theme={theme}
						items={items}
						requestLink={requestLink}
						open={open}
						onOpenChange={setOpen}
						returnFocus={() => button.current?.focus()}
					/>
				</Suspense>
			) : null}
		</>
	);
}
