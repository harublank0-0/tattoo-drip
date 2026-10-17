import {
	CalendarDays,
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
	calendar: CalendarDays,
	clients: Contact,
	settings: Settings,
};
