import { Menu } from "lucide-react";
import { type ComponentType, lazy, Suspense, useRef, useState } from "react";
import { studioCopy } from "../../copy.ts";
import type { NavItem } from "../../nav.ts";
import type { RequestLink } from "../../request.ts";
import type { StudioView } from "../../view-model.ts";
import type { ThemeConfig } from "../config.ts";
import type { IrezumiNavSheetProps } from "./mobile-nav-sheet.tsx";

/** The sheet's chunk (Radix's dialog): loaded on the first sign someone wants the menu. */
const loadSheet = () => import("./mobile-nav-sheet.tsx");

/** A chunk that fails to load leaves the menu shut; the footer still lists every page. */
const IrezumiNavSheet = lazy<ComponentType<IrezumiNavSheetProps>>(() =>
	loadSheet().catch(() => ({ default: NoSheet })),
);

function NoSheet(_: IrezumiNavSheetProps) {
	return null;
}

/**
 * The phone's menu (below 64rem): a 44 px button in the header that opens
 * the pages in a full-height sheet. The server renders only the closed
 * button; the sheet's code is fetched when a pointer comes over the button,
 * it takes focus or is pressed, and it stays mounted after the first open.
 * Without JavaScript the footer's page list carries the same links.
 */
export function IrezumiMobileNav({
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
				className="irz-menu-button"
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
				<span className="irz-menu-label">{studioCopy.nav.menu}</span>
			</button>
			{mounted ? (
				<Suspense fallback={null}>
					<IrezumiNavSheet
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
