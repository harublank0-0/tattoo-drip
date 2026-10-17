import {
	ClipboardList,
	Contact,
	Inbox,
	type LucideIcon,
	Settings,
} from "lucide-react";
import type { NavKey } from "~/components/shell/nav_items";

/** The icon for each destination in the tab bar and the sidebar. */
export const NAV_ICONS: Record<NavKey, LucideIcon> = {
	inbox: Inbox,
	projects: ClipboardList,
	clients: Contact,
	settings: Settings,
};
