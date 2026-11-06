import { Form, Link } from "@adonisjs/inertia/react";
import { usePage } from "@inertiajs/react";
import { cn } from "cn";
import {
	ChevronsUpDown,
	KeyRound,
	LogOut,
	Monitor,
	Moon,
	Sun,
	UserRound,
} from "lucide-react";
import { THEME_CHOICES, type ThemePreference } from "~/components/shell/theme";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { useTheme } from "~/hooks/use-theme";

const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/**
 * The signed-in person's menu: who they are, "Your account" (the password and
 * other devices, TAT-95: every role, every page), "Your artist profile" for
 * artists (TAT-30), the appearance (light, dark or the device's) and Log out.
 *
 * `variant`: "sidebar" (the expanded sidebar's footer: initials, name and
 * email), "rail" (the collapsed sidebar: initials, name in a tooltip) or
 * "bar" (the top bar: initials).
 */
export default function AccountMenu({
	variant = "bar",
}: {
	variant?: "sidebar" | "rail" | "bar";
}) {
	const { user, tenant } = usePage().props;
	const { preference, setPreference } = useTheme();
	if (!user) return null;
	const name = user.fullName ?? user.email;

	const initials = (
		<span
			aria-hidden="true"
			className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[0.6875rem] font-semibold text-foreground"
		>
			{user.initials}
		</span>
	);

	const trigger = (
		<DropdownMenuTrigger
			aria-label={variant === "sidebar" ? undefined : "Account menu"}
			className={cn(
				"flex items-center gap-2.5 rounded-md text-left outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent",
				variant === "sidebar" && "min-h-11 w-full px-2 py-1.5",
				variant !== "sidebar" && "size-11 justify-center rounded-full",
			)}
		>
			{initials}
			{variant === "sidebar" && (
				<>
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="text-sm leading-snug font-medium wrap-anywhere">
							{name}
						</span>
						{user.fullName && (
							<span className="text-xs leading-snug text-muted-foreground wrap-anywhere">
								{user.email}
							</span>
						)}
					</span>
					<ChevronsUpDown
						aria-hidden="true"
						className="size-4 shrink-0 text-muted-foreground"
					/>
				</>
			)}
		</DropdownMenuTrigger>
	);

	return (
		<DropdownMenu>
			{variant === "rail" ? (
				<Tooltip>
					<TooltipTrigger asChild>{trigger}</TooltipTrigger>
					<TooltipContent side="right">{name}</TooltipContent>
				</Tooltip>
			) : (
				trigger
			)}
			<DropdownMenuContent
				align="end"
				side={variant === "bar" ? "bottom" : "right"}
				className="w-64"
			>
				<DropdownMenuLabel className="flex flex-col">
					{user.fullName && (
						<span className="wrap-anywhere">{user.fullName}</span>
					)}
					<span className="text-xs font-normal text-muted-foreground wrap-anywhere">
						{user.email}
					</span>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem asChild>
						<Link route="account.show">
							<KeyRound />
							Your account
						</Link>
					</DropdownMenuItem>
					{tenant?.role === "artist" && (
						<DropdownMenuItem asChild>
							<Link
								route="tenant.artists.mine"
								routeParams={{ tenant: tenant.slug }}
							>
								<UserRound />
								Your artist profile
							</Link>
						</DropdownMenuItem>
					)}
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
					Appearance
				</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={preference}
					onValueChange={(value) => setPreference(value as ThemePreference)}
				>
					{THEME_CHOICES.map(({ value, label }) => {
						const Icon = THEME_ICONS[value];
						return (
							<DropdownMenuRadioItem
								key={value}
								value={value}
								// Kept open, so the change shows behind the menu.
								onSelect={(event) => event.preventDefault()}
							>
								<Icon />
								{label}
							</DropdownMenuRadioItem>
						);
					})}
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				{/* Kept open on select so the form is still mounted when it submits. */}
				<Form route="session.destroy">
					<DropdownMenuItem
						asChild
						onSelect={(event) => event.preventDefault()}
					>
						<button type="submit" className="w-full">
							<LogOut />
							Log out
						</button>
					</DropdownMenuItem>
				</Form>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
