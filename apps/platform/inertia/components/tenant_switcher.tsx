import { Link } from "@adonisjs/inertia/react";
import { usePage } from "@inertiajs/react";
import { Check, ChevronsUpDown } from "lucide-react";
import { urlFor } from "~/client";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

const ROLE_LABELS: Record<string, string> = {
	owner: "Owner",
	artist: "Artist",
};

/**
 * The current tenant's name in the header. With more than one tenant it
 * opens a menu to switch between them. Renders nothing outside tenant
 * pages.
 */
export default function TenantSwitcher() {
	const { tenant, tenants } = usePage().props;
	if (!tenant) return null;

	if (!tenants || tenants.length < 2) {
		return <span className="truncate text-sm font-medium">{tenant.name}</span>;
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="sm" className="max-w-56 justify-between">
					<span className="truncate">{tenant.name}</span>
					<ChevronsUpDown data-icon="inline-end" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-64">
				<DropdownMenuLabel>Switch business</DropdownMenuLabel>
				{tenants.map((item) => (
					<DropdownMenuItem key={item.slug} asChild>
						<Link
							href={urlFor("tenant.dashboard", { tenant: item.slug })}
							aria-current={item.slug === tenant.slug ? "true" : undefined}
						>
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="truncate">{item.name}</span>
								<span className="text-xs text-muted-foreground">
									{ROLE_LABELS[item.role] ?? item.role}
								</span>
							</span>
							{item.slug === tenant.slug && <Check />}
						</Link>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
