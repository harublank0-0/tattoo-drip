import { Link } from "@adonisjs/inertia/react";
import { usePage } from "@inertiajs/react";
import { cn } from "cn";
import { Check, ChevronsUpDown } from "lucide-react";
import type { ReactElement } from "react";
import { urlFor } from "~/client";
import { ROLE_LABELS } from "~/components/shell/studio";
import StudioMark from "~/components/shell/studio_mark";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";

/**
 * The current studio in the shell: its mark, its name and the member's role.
 * With more than one studio it opens a menu of the member's studios (the
 * shared `tenants`, which the server limits to their live memberships); each
 * is a plain link to that studio's dashboard, so the server decides access on
 * every switch. Renders nothing outside studio pages.
 *
 * `variant`: "sidebar" (the expanded sidebar, full width), "rail" (the
 * collapsed sidebar: the mark alone, its name in a tooltip) or "bar" (the
 * phone's top bar).
 */
export default function TenantSwitcher({
	variant = "bar",
}: {
	variant?: "sidebar" | "rail" | "bar";
}) {
	const { tenant, tenants } = usePage().props;
	if (!tenant) return null;
	const switches = (tenants?.length ?? 0) > 1;
	const rail = variant === "rail";

	const identity = (
		<>
			<StudioMark
				name={tenant.name}
				logoUrl={tenant.logoUrl}
				className={cn(rail && "size-8")}
			/>
			{rail ? (
				<span className="sr-only">{tenant.name}</span>
			) : (
				<span className="flex min-w-0 flex-1 flex-col text-left">
					<span className="text-sm leading-snug font-semibold wrap-anywhere">
						{tenant.name}
					</span>
					{variant === "sidebar" && (
						<span className="text-xs leading-snug font-normal text-muted-foreground">
							{ROLE_LABELS[tenant.role]}
						</span>
					)}
				</span>
			)}
			{switches && !rail && (
				<ChevronsUpDown
					aria-hidden="true"
					className="size-4 shrink-0 text-muted-foreground"
				/>
			)}
		</>
	);

	const frame = cn(
		"flex items-center gap-2.5 rounded-md text-foreground",
		variant === "sidebar" && "min-h-11 w-full px-2 py-1.5",
		variant === "bar" && "min-h-11 max-w-64 px-1.5 py-1",
		rail && "size-11 justify-center",
	);

	if (!switches) {
		const still = <div className={frame}>{identity}</div>;
		return rail ? withTooltip(still, tenant.name) : still;
	}

	const trigger = (
		<DropdownMenuTrigger
			className={cn(
				frame,
				"outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent",
			)}
			aria-label={rail ? `${tenant.name}: switch business` : undefined}
		>
			{identity}
		</DropdownMenuTrigger>
	);

	return (
		<DropdownMenu>
			{rail ? withTooltip(trigger, tenant.name) : trigger}
			<DropdownMenuContent
				align="start"
				side={rail ? "right" : "bottom"}
				className="w-64"
			>
				<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
					Switch business
				</DropdownMenuLabel>
				{tenants?.map((item) => {
					const current = item.slug === tenant.slug;
					return (
						<DropdownMenuItem key={item.slug} asChild>
							<Link
								href={urlFor("tenant.dashboard", { tenant: item.slug })}
								aria-current={current ? "true" : undefined}
							>
								<StudioMark
									name={item.name}
									logoUrl={current ? tenant.logoUrl : null}
									className="size-6 text-[0.625rem]"
								/>
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="wrap-anywhere">{item.name}</span>
									<span className="text-xs text-muted-foreground">
										{ROLE_LABELS[item.role]}
									</span>
								</span>
								{current && <Check aria-hidden="true" />}
							</Link>
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** The collapsed rail's studio, named in a tooltip on hover (and on focus when it is a button). */
function withTooltip(child: ReactElement, label: string) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>{child}</TooltipTrigger>
			<TooltipContent side="right">{label}</TooltipContent>
		</Tooltip>
	);
}
