import { Moon, Sun } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useTheme } from "~/hooks/use-theme";

/**
 * Switches between light and dark. Shows the icon of the theme it switches
 * to: a moon in light mode, a sun in dark mode.
 */
export default function ThemeToggle() {
	const { theme, setTheme } = useTheme();
	const isDark = theme === "dark";
	const label = isDark ? "Switch to light theme" : "Switch to dark theme";

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			onClick={() => setTheme(isDark ? "light" : "dark")}
			aria-label={label}
			title={label}
		>
			<Sun className="scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0" />
			<Moon className="absolute scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90" />
		</Button>
	);
}
