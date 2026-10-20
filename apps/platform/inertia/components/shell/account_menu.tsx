import { Form, Link } from "@adonisjs/inertia/react";
import { usePage } from "@inertiajs/react";
import { cn } from "cn";
import { LogOut, Moon, Sun, UserRound } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useTheme } from "~/hooks/use-theme";

/**
 * The signed-in person's menu: who they are, the light/dark switch and
 * Log out. The trigger is their initials; in the sidebar it adds the name.
 * Artists also get "Your artist profile" (TAT-30).
 */
export default function AccountMenu({
	showName = false,
}: {
	showName?: boolean;
}) {
	const { user, tenant } = usePage().props;
	const { theme, setTheme } = useTheme();
	if (!user) return null;
	const dark = theme === "dark";

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size={showName ? "default" : "icon"}
					className={cn(showName ? "w-full justify-start" : "rounded-full")}
					aria-label="Account menu"
				>
					<span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">
						{user.initials}
					</span>
					{showName && (
						<span className="truncate">{user.fullName ?? user.email}</span>
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-60">
				<DropdownMenuLabel className="flex flex-col">
					{user.fullName && <span className="truncate">{user.fullName}</span>}
					<span className="truncate text-xs font-normal text-muted-foreground">
						{user.email}
					</span>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
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
				<DropdownMenuItem
					onSelect={(event) => {
						event.preventDefault();
						setTheme(dark ? "light" : "dark");
					}}
				>
					{dark ? <Sun /> : <Moon />}
					{dark ? "Light theme" : "Dark theme"}
				</DropdownMenuItem>
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
