import {
	CalendarDays,
	ClipboardList,
	Contact,
	Ellipsis,
	House,
	Images,
	Inbox,
	type LucideIcon,
	Package,
	Receipt,
	Settings,
	Star,
	Users,
} from "lucide-react";
import type { NavKey } from "~/components/shell/nav_items";

/** The icon for each destination in the tab bar and the sidebar. */
export const NAV_ICONS: Record<NavKey, LucideIcon> = {
	today: House,
	inbox: Inbox,
	projects: ClipboardList,
	calendar: CalendarDays,
	clients: Contact,
	artists: Users,
	portfolio: Images,
	reviews: Star,
	inventory: Package,
	transactions: Receipt,
	settings: Settings,
};

/** The More tab's icon (TAT-107). */
export const MORE_ICON: LucideIcon = Ellipsis;
